// The only module that touches the Obsidian Bases API (BasesView, BasesEntry,
// BasesViewConfig, Value, registerBasesView). If the Bases API changes, change this file.

import {
	BasesAllOptions,
	BasesEntry,
	BasesPropertyId,
	BasesView,
	debounce,
	Menu,
	Modal,
	moment,
	Notice,
	Platform,
	NullValue,
	Plugin,
	QueryController,
	TFile,
	type Value,
} from 'obsidian';
import { AddTaskModal } from './add-task-modal.ts';
import { BOARD_FIELD_LABELS, BOARD_FIELDS, boardColumns, moveFor, normalizeBoardField, type BoardColumn, type BoardMove } from './board.ts';
import { TaskBoard, type MenuChoice } from './board-view.ts';
import { CALENDAR_FIELD_LABELS, CALENDAR_FIELDS, CALENDAR_LAYOUT_CHOICES, CALENDAR_LAYOUT_LABELS, isRealDate, moveToDate, normalizeCalendarField, normalizeCalendarLayout } from './calendar.ts';
import { TaskCalendar } from './calendar-view.ts';
import { columnOptionKey, TASK_COLUMNS, type ColumnContext } from './columns.ts';
import type { TaskEdit } from './edit.ts';
import type { IndexedTask } from './extract.ts';
import { ALL_PATHS, type TaskIndex } from './indexer.ts';
import type { TaskWriter } from './writer.ts';
import { applyQuery, normalizeQuery, summarize, type TaskQuery } from './query.ts';
import { TaskToolbar, type PropChoice } from './toolbar.ts';
import { localDate, renderRows, type RowSource, type ViewRow } from './view.ts';
import { ROW_HEIGHT, TOUCH_ROW_HEIGHT, VirtualList } from './virtual-list.ts';

export const VIEW_TYPE = 'tasklines';
export const BOARD_VIEW_TYPE = 'tasklines-board';
export const CALENDAR_VIEW_TYPE = 'tasklines-calendar';
const QUERY_KEY = 'taskQuery';
const BOARD_FIELD_KEY = 'boardField';
const CALENDAR_FIELD_KEY = 'calendarField';
const CALENDAR_LAYOUT_KEY = 'calendarLayout';

/** Registers the list and board views; false if Bases is not available. */
export function registerTasklinesView(plugin: Plugin, index: TaskIndex, writer: TaskWriter): boolean {
	const list = plugin.registerBasesView(VIEW_TYPE, {
		name: 'Tasklines',
		icon: 'lucide-list-checks',
		factory: (controller, containerEl) => new TasklinesView(controller, containerEl, index, writer),
		options: () => viewOptions(),
	});
	if (!list) return false;
	plugin.registerBasesView(BOARD_VIEW_TYPE, {
		name: 'Task board',
		icon: 'lucide-kanban',
		factory: (controller, containerEl) => new TaskBoardView(controller, containerEl, index, writer),
		options: () => boardOptions(),
	});
	plugin.registerBasesView(CALENDAR_VIEW_TYPE, {
		name: 'Task calendar',
		icon: 'lucide-calendar-days',
		factory: (controller, containerEl) => new TaskCalendarView(controller, containerEl, index, writer),
		options: () => calendarOptions(),
	});
	return true;
}

function calendarOptions(): BasesAllOptions[] {
	return [
		{ type: 'toggle', key: 'showToolbar', displayName: 'Show task toolbar', default: true },
		{ type: 'dropdown', key: CALENDAR_FIELD_KEY, displayName: 'Date', default: 'due', options: Object.fromEntries(CALENDAR_FIELDS.map((f) => [f, CALENDAR_FIELD_LABELS[f]])) },
		// Automatic by default, so one .base file gives phones the agenda and other devices the month.
		{ type: 'dropdown', key: CALENDAR_LAYOUT_KEY, displayName: 'Layout', default: 'auto', options: Object.fromEntries(CALENDAR_LAYOUT_CHOICES.map((l) => [l, CALENDAR_LAYOUT_LABELS[l]])) },
	];
}

function boardOptions(): BasesAllOptions[] {
	return [
		{ type: 'toggle', key: 'showToolbar', displayName: 'Show task toolbar', default: true },
		{
			type: 'dropdown',
			key: BOARD_FIELD_KEY,
			displayName: 'Columns',
			default: 'status',
			options: Object.fromEntries(BOARD_FIELDS.map((f) => [f, BOARD_FIELD_LABELS[f]])),
		},
	];
}

function viewOptions(): BasesAllOptions[] {
	return [
		{ type: 'toggle', key: 'showToolbar', displayName: 'Show task toolbar', default: true },
		{
			type: 'group',
			displayName: 'Task columns',
			items: TASK_COLUMNS.map((c) => ({
				type: 'toggle' as const,
				key: columnOptionKey(c.key),
				displayName: c.label,
				default: c.defaultOn,
			})),
		},
	];
}

interface NoteSnapshot {
	entry: RowSource;
	noteIndex: number;
	baseGroup: string;
	baseGroupIndex: number;
}

/** What the list and the board share: snapshots of the base, the toolbar, refreshes and writes. */
abstract class TaskViewBase extends BasesView {
	protected index: TaskIndex;
	protected writer: TaskWriter;
	protected rootEl: HTMLElement;
	protected toolbar: TaskToolbar;
	protected statsEl: HTMLElement;
	protected query: TaskQuery = normalizeQuery(null);
	protected notes: NoteSnapshot[] = [];
	protected paths = new Set<string>();
	private renderToken = 0;
	private unsubscribe: (() => void) | null = null;
	private lastToday = localDate(new Date());
	private dayTimer: number;
	private rerenderSoon = debounce(
		() => {
			// `this.data` is still the current result (no onDataUpdated since), so re-reading it is safe.
			this.snapshot();
			this.render();
		},
		300,
		true,
	);

	constructor(controller: QueryController, parentEl: HTMLElement, index: TaskIndex, writer: TaskWriter, toolbar: { showGroup: boolean }) {
		super(controller);
		this.index = index;
		this.writer = writer;
		this.rootEl = parentEl.createDiv({ cls: 'tasklines-view' });
		this.toolbar = new TaskToolbar(this.rootEl, this.query, (q) => this.onQueryChange(q), () => this.openAddTask(), {
			collapsible: Platform.isMobile,
			showGroup: toolbar.showGroup,
		});
		this.statsEl = this.rootEl.createDiv({ cls: 'tasklines-stats' });
		this.rootEl.toggleClass('tasklines-touch', Platform.isMobile);
		// Bases may not call onDataUpdated when only a note's body changes (no property
		// changed), so re-render ourselves when a note in the current result set changes.
		// Subscribed here rather than in onload() because the docs do not say whether
		// Bases loads the view as a child component.
		this.unsubscribe = this.index.onInvalidate((paths) => {
			// If the view was torn down without onunload, stop listening instead of leaking.
			if (!this.rootEl.isConnected && this.notes.length) return this.onunload();
			if (paths.some((p) => p === ALL_PATHS || this.paths.has(p))) this.rerenderSoon();
		});
		// "Today", "Overdue" and due-date columns change at midnight even if no note does.
		this.dayTimer = window.setInterval(() => {
			const today = localDate(new Date());
			if (today === this.lastToday) return;
			this.lastToday = today;
			if (this.rootEl.isConnected) this.render();
		}, 60_000);
	}

	onunload(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		window.clearInterval(this.dayTimer);
		this.rerenderSoon.cancel();
		this.notes = [];
	}

	onDataUpdated(): void {
		this.query = normalizeQuery(this.config.get(QUERY_KEY));
		this.rootEl.toggleClass('tasklines-no-toolbar', this.config.get('showToolbar') === false);
		this.toolbar.update(this.query, this.propChoices());
		this.snapshot();
		this.render();
	}

	protected onQueryChange(q: TaskQuery): void {
		this.query = q;
		// Saved in the .base file so each view keeps its own preset.
		this.config.set(QUERY_KEY, q);
		// A new sort or group key may need property values we did not resolve yet.
		this.snapshot();
		this.render();
	}

	/** The query actually applied; the board ignores the saved grouping. */
	protected effectiveQuery(): TaskQuery {
		return this.query;
	}

	/**
	 * Copy what we need from `this.data` now. It and its entries are replaced on every
	 * update, so no entry objects are kept across updates.
	 */
	private snapshot(): void {
		const q = this.effectiveQuery();
		const props = new Set<BasesPropertyId>(this.config.getOrder());
		for (const key of [...q.sort.map((s) => s.key), q.group]) {
			if (key.startsWith('prop:')) props.add(key.slice(5) as BasesPropertyId);
		}
		const notes: NoteSnapshot[] = [];
		// Every note in the base, including task-free ones, so a note that gains its
		// first task in a body edit still triggers a refresh.
		const paths = new Set<string>();
		let noteIndex = 0;
		this.data.groupedData.forEach((g, baseGroupIndex) => {
			const baseGroup = g.hasKey() ? valueText(g.key) : '';
			for (const e of g.entries) {
				const i = noteIndex++;
				paths.add(e.file.path);
				// Known to have no tasks: skip resolving its properties.
				if (this.index.peek(e.file)?.length === 0) continue;
				notes.push({ entry: snapshotEntry(e, props), noteIndex: i, baseGroup, baseGroupIndex });
			}
		});
		this.notes = notes;
		this.paths = paths;
	}

	protected render(): void {
		void this.renderAsync();
	}

	private async renderAsync(): Promise<void> {
		const notes = this.notes;
		const token = ++this.renderToken;
		const tasksByPath = await this.index.tasksFor(notes.map((n) => n.entry.file));
		if (token !== this.renderToken) return; // superseded by a newer render
		const rows: ViewRow[] = [];
		for (const n of notes) {
			const tasks = tasksByPath.get(n.entry.file.path);
			if (!tasks?.length) continue;
			const props = new Map<string, string>();
			for (const [id, v] of n.entry.values) props.set(id, valueText(v));
			for (const task of tasks) {
				rows.push({ task, entry: n.entry, noteIndex: n.noteIndex, noteName: n.entry.file.basename, baseGroup: n.baseGroup, baseGroupIndex: n.baseGroupIndex, props });
			}
		}
		this.lastToday = localDate(new Date());
		this.draw(rows, tasksByPath, this.lastToday);
	}

	protected abstract draw(rows: ViewRow[], tasksByPath: Map<string, IndexedTask[]>, today: string): void;

	/** All notes the base selects, and how many have at least one task. */
	protected noteCounts(tasksByPath: Map<string, IndexedTask[]>): { total: number; withTasks: number } {
		// Notes known to have no tasks are skipped before indexing, so count from all paths.
		return { total: this.paths.size, withTasks: [...tasksByPath.values()].filter((t) => t.length > 0).length };
	}

	private lastAddPath: string | null = null;

	private openAddTask(): void {
		const notes = [...this.paths]
			.filter((p) => p.endsWith('.md'))
			.map((path) => ({ path, label: path.replace(/\.md$/, '') }))
			.sort((a, b) => a.label.localeCompare(b.label));
		if (!notes.length) {
			new Notice('Tasklines: this base has no notes to add a task to.');
			return;
		}
		const fallback = this.notes[0]?.entry.file.path ?? notes[0]?.path ?? '';
		const initial = this.lastAddPath && this.paths.has(this.lastAddPath) ? this.lastAddPath : fallback;
		new AddTaskModal(this.app, notes, initial, (path, task) => {
			this.lastAddPath = path;
			void this.writer.add(path, task);
		}).open();
	}

	private propChoices(): PropChoice[] {
		return this.allProperties.map((id) => ({ id, label: this.config.getDisplayName(id) }));
	}

	protected openTask(path: string, line: number, newTab: boolean): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file, { eState: { line } });
	}
}

class TasklinesView extends TaskViewBase {
	readonly type = VIEW_TYPE;
	private list: VirtualList;

	constructor(controller: QueryController, parentEl: HTMLElement, index: TaskIndex, writer: TaskWriter) {
		super(controller, parentEl, index, writer, { showGroup: true });
		this.list = new VirtualList(this.rootEl, Platform.isMobile ? TOUCH_ROW_HEIGHT : ROW_HEIGHT);
	}

	onunload(): void {
		super.onunload();
		this.list.destroy();
	}

	protected draw(rows: ViewRow[], tasksByPath: Map<string, IndexedTask[]>, today: string): void {
		const columns = this.config.getOrder().filter((p) => p !== 'file.name');
		renderRows(this.statsEl, this.list, {
			groups: applyQuery(rows, this.query, today),
			context: columnContext(tasksByPath, today),
			total: rows.length,
			columns,
			columnNames: columns.map((p) => this.config.getDisplayName(p)),
			taskColumns: TASK_COLUMNS.filter((c) => {
				const v = this.config.get(columnOptionKey(c.key));
				return typeof v === 'boolean' ? v : c.defaultOn;
			}),
			stats: this.index.lastStats,
			notes: this.noteCounts(tasksByPath),
			openTask: (path, line, newTab) => this.openTask(path, line, newTab),
			toggleTask: (task) => this.writer.toggle({ path: task.path, line: task.line, raw: task.raw }),
			tasksPluginAvailable: this.writer.tasksPluginAvailable(),
			touch: Platform.isMobile,
			editTask: (task, edit) => this.writer.edit({ path: task.path, line: task.line, raw: task.raw }, edit),
			renderValue: (el, entry, prop) => {
				const value = entry.values.get(prop);
				if (value && !(value instanceof NullValue)) value.renderTo(el, this.app.renderContext);
			},
		});
	}
}

class TaskBoardView extends TaskViewBase {
	readonly type = BOARD_VIEW_TYPE;
	private board: TaskBoard;

	constructor(controller: QueryController, parentEl: HTMLElement, index: TaskIndex, writer: TaskWriter) {
		super(controller, parentEl, index, writer, { showGroup: false });
		this.board = new TaskBoard(this.rootEl, this.statsEl);
		this.rootEl.addClass('tasklines-board-view');
	}

	onunload(): void {
		super.onunload();
		this.board.el.remove();
	}

	protected onQueryChange(q: TaskQuery): void {
		this.board.resetLimits();
		super.onQueryChange(q);
	}

	protected effectiveQuery(): TaskQuery {
		// Columns take the place of groups; a group saved from a list view must not apply.
		return { ...this.query, group: 'none' };
	}

	protected draw(rows: ViewRow[], tasksByPath: Map<string, IndexedTask[]>, today: string): void {
		const field = normalizeBoardField(this.config.get(BOARD_FIELD_KEY));
		const sorted = applyQuery(rows, this.effectiveQuery(), today).flatMap((g) => g.rows);
		this.board.render({
			columns: boardColumns(sorted, field, today),
			total: rows.length,
			today,
			field,
			stats: this.index.lastStats,
			notes: this.noteCounts(tasksByPath),
			openTask: (path, line, newTab) => this.openTask(path, line, newTab),
			toggleTask: (task) => this.writer.toggle({ path: task.path, line: task.line, raw: task.raw }),
			// Worked out when the move happens, so "Today" is today even after midnight.
			moveFor: (task, column) => moveFor(task, column, localDate(new Date())),
			move: (task, move, column) => this.move(task, move, column),
			showMenu: (anchor, ev, choices) => showMenu(anchor, ev, choices),
			tasksPluginAvailable: this.writer.tasksPluginAvailable(),
			touch: Platform.isMobile,
		});
	}

	private async move(task: IndexedTask, move: BoardMove, column: BoardColumn): Promise<boolean> {
		const target = { path: task.path, line: task.line, raw: task.raw };
		if (move.kind === 'blocked') {
			new Notice(`Tasklines: ${move.reason} Nothing was changed.`);
			return false;
		}
		// Completing a recurring task may add its next occurrence, so it is not undoable here.
		if (move.kind === 'toggle') return this.writer.toggle(target, true);
		return editWithUndo(this.writer, task, move.edit, column.label);
	}
}

/** Make one edit and offer to put the line back exactly as it was. */
async function editWithUndo(writer: TaskWriter, task: IndexedTask, edit: TaskEdit, label: string): Promise<boolean> {
	const written = await writer.editLine({ path: task.path, line: task.line, raw: task.raw }, edit);
	if (written === null) return false;
	const message = new DocumentFragment();
	message.createSpan({ text: `Moved to ${label}. ` });
	const undo = message.createEl('button', { text: 'Undo', cls: 'tasklines-notice-btn' });
	// Long enough to reach Undo on a phone.
	const notice = new Notice(message, 8000);
	undo.addEventListener('click', () => {
		notice.hide();
		void writer.restore({ path: task.path, line: task.line, raw: written }, task.raw);
	});
	return true;
}

class TaskCalendarView extends TaskViewBase {
	readonly type = CALENDAR_VIEW_TYPE;
	private calendar: TaskCalendar;

	constructor(controller: QueryController, parentEl: HTMLElement, index: TaskIndex, writer: TaskWriter) {
		super(controller, parentEl, index, writer, { showGroup: false });
		this.calendar = new TaskCalendar(this.rootEl, this.statsEl);
		this.rootEl.addClass('tasklines-calendar-view');
	}

	onunload(): void {
		super.onunload();
		this.calendar.el.remove();
	}

	protected onQueryChange(q: TaskQuery): void {
		this.calendar.resetLimits();
		super.onQueryChange(q);
	}

	protected effectiveQuery(): TaskQuery {
		// Days take the place of groups; a group saved from a list view must not apply.
		return { ...this.query, group: 'none' };
	}

	protected draw(rows: ViewRow[], tasksByPath: Map<string, IndexedTask[]>, today: string): void {
		const field = normalizeCalendarField(this.config.get(CALENDAR_FIELD_KEY));
		this.calendar.render({
			rows: applyQuery(rows, this.effectiveQuery(), today).flatMap((g) => g.rows),
			total: rows.length,
			today,
			field,
			layout: normalizeCalendarLayout(this.config.get(CALENDAR_LAYOUT_KEY), Platform.isPhone ? 'agenda' : 'month'),
			weekStart: moment.localeData().firstDayOfWeek(),
			stats: this.index.lastStats,
			notes: this.noteCounts(tasksByPath),
			openTask: (path, line, newTab) => this.openTask(path, line, newTab),
			toggleTask: (task) => this.writer.toggle({ path: task.path, line: task.line, raw: task.raw }),
			move: (task, date, label) => {
				const edit = moveToDate(task, field, date);
				return edit ? editWithUndo(this.writer, task, edit, label) : Promise.resolve(false);
			},
			showMenu: (anchor, ev, choices) => showMenu(anchor, ev, choices),
			pickDate: (current) => new Promise((resolve) => new DatePickModal(this.app, current, resolve).open()),
			tasksPluginAvailable: this.writer.tasksPluginAvailable(),
			touch: Platform.isMobile,
		});
	}
}

/** "Pick a date…": a date field with Save and Cancel. Resolves undefined when cancelled. */
class DatePickModal extends Modal {
	private value: string | undefined;
	private done: (date: string | undefined) => void;
	private result: string | undefined;

	constructor(app: Plugin['app'], value: string | undefined, done: (date: string | undefined) => void) {
		super(app);
		this.value = value;
		this.done = done;
	}

	onOpen(): void {
		this.setTitle('Pick a date');
		const input = this.contentEl.createEl('input', { type: 'date', cls: 'tasklines-date-pick', attr: { 'aria-label': 'Date', min: '1000-01-01', max: '9999-12-31' } });
		input.value = this.value ?? '';
		const error = this.contentEl.createDiv({ cls: 'tasklines-date-error', attr: { role: 'alert' } });
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const save = buttons.createEl('button', { text: 'Save', cls: 'mod-cta' });
		const cancel = buttons.createEl('button', { text: 'Cancel' });
		const valid = () => isRealDate(input.value);
		const check = () => {
			save.disabled = !valid();
			error.setText(input.value && !valid() ? 'Enter a complete date.' : '');
		};
		const commit = () => {
			if (!valid()) {
				error.setText('Enter a complete date.');
				return;
			}
			this.result = input.value;
			this.close();
		};
		input.addEventListener('input', check);
		input.addEventListener('change', check);
		save.addEventListener('click', commit);
		cancel.addEventListener('click', () => this.close());
		input.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter') {
				ev.preventDefault();
				commit();
			}
		});
		check();
		window.setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
		this.done(this.result);
	}
}

function showMenu(anchor: HTMLElement, ev: MouseEvent, choices: MenuChoice[]): void {
	const menu = new Menu();
	for (const c of choices) menu.addItem((item) => item.setTitle(c.label).setDisabled(c.disabled ?? false).onClick(() => c.run()));
	// A keyboard "click" has no pointer position: open under the button instead.
	if (ev.detail > 0) return void menu.showAtMouseEvent(ev);
	const rect = anchor.getBoundingClientRect();
	menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument);
}

/** Lookups for computed columns, built from all tasks in the base (before task filters). */
function columnContext(tasksByPath: Map<string, IndexedTask[]>, today: string): ColumnContext {
	const byLine = new Map<string, Map<number, IndexedTask>>();
	const progress = new Map<string, { done: number; total: number }>();
	for (const [path, tasks] of tasksByPath) {
		byLine.set(path, new Map(tasks.map((t) => [t.line, t])));
		const s = summarize(tasks.map((task) => ({ task })), today);
		progress.set(path, { done: s.done, total: s.open + s.done });
	}
	return {
		today,
		taskAt: (path, line) => byLine.get(path)?.get(line),
		noteProgress: (path) => progress.get(path) ?? { done: 0, total: 0 },
	};
}

function snapshotEntry(entry: BasesEntry, props: Iterable<BasesPropertyId>): RowSource {
	const values = new Map<string, Value | null>();
	for (const prop of props) values.set(prop, entry.getValue(prop));
	return { file: entry.file, values };
}

/** Display text for sorting and grouping; null and missing values become ''. */
function valueText(v: Value | null | undefined): string {
	if (!v || v instanceof NullValue) return '';
	return v.toString();
}
