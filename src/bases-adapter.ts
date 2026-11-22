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
import { CALENDAR_FIELD_LABELS, CALENDAR_FIELDS, CALENDAR_LAYOUT_CHOICES, CALENDAR_LAYOUT_LABELS, isRealDate, moveToDate, type CalendarField, normalizeCalendarField, normalizeCalendarLayout } from './calendar.ts';
import { TaskCalendar } from './calendar-view.ts';
import { copyText, describePlan, describeSummary, orderForWrite, planBulk, rangeKeys, shiftRecords, summarize as summarizeBatch, type BulkAction, type CopyMode, type StepOutcome, type UndoRecord } from './bulk.ts';
import { refreshGroupSelects, SelectionBar, type SelectionHooks } from './selection-bar.ts';
import { columnOptionKey, TASK_COLUMNS, type ColumnContext } from './columns.ts';
import type { TaskEdit } from './edit.ts';
import type { IndexedTask } from './extract.ts';
import { ALL_PATHS, type TaskIndex } from './indexer.ts';
import type { TaskWriter } from './writer.ts';
import { COLOR_BY, COLOR_BY_LABELS, normalizeColorBy, tintFor, type Tint } from './tint.ts';
import { addDays, applyQuery, normalizeQuery, summarize, type TaskQuery } from './query.ts';
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
const COLOR_BY_KEY = 'colorBy';
const COLOR_PROPERTY_KEY = 'colorProperty';

/** The Color options, the same in every view. */
function colorOptions(): BasesAllOptions[] {
	return [
		{ type: 'dropdown', key: COLOR_BY_KEY, displayName: 'Color', default: 'none', options: Object.fromEntries(COLOR_BY.map((c) => [c, COLOR_BY_LABELS[c]])) },
		{ type: 'property', key: COLOR_PROPERTY_KEY, displayName: 'Color property', placeholder: 'Used when Color is Note property' },
	];
}

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
		...colorOptions(),
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
		...colorOptions(),
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
		...colorOptions(),
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
	/** Select mode for bulk actions, and the selection: task key → the line as selected. */
	protected selecting = false;
	private selected = new Map<string, string>();
	/** Every task in the base (before task filters), from the last render. */
	private allRows: ViewRow[] = [];
	/** The tasks the view shows (after filters), for "Select all". Set by each view's draw. */
	protected shownRows: ViewRow[] = [];
	/** The shown tasks in the order they appear on screen, for Shift-click ranges and copying. Set by each view's draw. */
	protected screenRows: ViewRow[] = [];
	/** The last task ticked, where a Shift-click range starts. */
	private anchorKey: string | null = null;
	private selectionBar: SelectionBar;
	/** A batch being written. Redraws wait until it ends. */
	private batch: { cancel: boolean; done: number; total: number } | null = null;
	private refreshAfterBatch = false;
	private lastUndo: { label: string; records: UndoRecord[] } | null = null;
	/** The batch's notice, closed when Undo is pressed in the bar so its own Undo isn't left doing nothing. */
	private undoNotice: Notice | null = null;
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
			onSelect: () => this.setSelecting(!this.selecting),
		});
		this.statsEl = this.rootEl.createDiv({ cls: 'tasklines-stats' });
		this.selectionBar = new SelectionBar(this.rootEl, this.statsEl, {
			run: (action, verb) => void this.runBulk(action, verb),
			selectAll: () => this.selectAll(),
			clear: () => {
				this.selected.clear();
				this.anchorKey = null;
				this.render();
			},
			undo: () => {
				this.undoNotice?.hide();
				void this.runUndo();
			},
			cancel: () => {
				if (this.batch) this.batch.cancel = true;
			},
			exit: () => this.setSelecting(false),
			copy: (mode) => void this.copySelected(mode),
		});
		this.rootEl.addEventListener('keydown', (ev) => {
			if (ev.key !== 'Escape' || !this.selecting || this.batch) return;
			const t = ev.target as HTMLElement | null;
			if (t?.closest('input:not([type="checkbox"]), select, textarea')) return;
			ev.preventDefault();
			this.setSelecting(false);
		});
		this.rootEl.toggleClass('tasklines-touch', Platform.isMobile);
		// Bases may not call onDataUpdated when only a note's body changes (no property
		// changed), so re-render ourselves when a note in the current result set changes.
		// Subscribed here rather than in onload() because the docs do not say whether
		// Bases loads the view as a child component.
		this.unsubscribe = this.index.onInvalidate((paths) => {
			// If the view was torn down without onunload, stop listening instead of leaking.
			if (!this.rootEl.isConnected && this.notes.length) return this.onunload();
			if (!paths.some((p) => p === ALL_PATHS || this.paths.has(p))) return;
			// During a batch every write changes a note; redraw once at the end instead.
			if (this.batch) this.refreshAfterBatch = true;
			else this.rerenderSoon();
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

	/** The property chosen for "Color: Note property", if Color is set to it. */
	private colorProperty(): BasesPropertyId | null {
		if (normalizeColorBy(this.config.get(COLOR_BY_KEY)) !== 'property') return null;
		return this.config.getAsPropertyId(COLOR_PROPERTY_KEY);
	}

	/** The view's Color option as a function of a row, or undefined when it is off. */
	protected tint(today: string): ((row: ViewRow) => Tint | null) | undefined {
		const by = normalizeColorBy(this.config.get(COLOR_BY_KEY));
		if (by === 'none') return undefined;
		const id = this.colorProperty();
		const property = id ? { id, name: this.config.getDisplayName(id) } : null;
		return (row) => tintFor(row, by, today, property);
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
		for (const key of [...q.sort.map((s) => s.key), q.group, q.subgroup]) {
			if (key.startsWith('prop:')) props.add(key.slice(5) as BasesPropertyId);
		}
		const colorProp = this.colorProperty();
		if (colorProp) props.add(colorProp);
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
		if (this.batch) {
			this.refreshAfterBatch = true;
			return;
		}
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
		this.allRows = rows;
		// Keep only selections that still point at the same line: a key is a line number, and a
		// line inserted above would otherwise make it point at a different task.
		if (this.selected.size) {
			const raws = new Map(rows.map((r) => [taskKey(r.task), r.task.raw]));
			for (const [key, raw] of this.selected) if (raws.get(key) !== raw) this.selected.delete(key);
		}
		this.draw(rows, tasksByPath, this.lastToday);
		this.updateBar();
	}

	/** What the views need to draw select mode. */
	protected selectionHooks(): SelectionHooks | undefined {
		if (!this.selecting) return undefined;
		return {
			active: true,
			has: (t) => this.selected.get(taskKey(t)) === t.raw,
			toggle: (t, on, range) => {
				const key = taskKey(t);
				const keys = range && this.anchorKey ? rangeKeys(this.screenRows.map((r) => taskKey(r.task)), this.anchorKey, key) : null;
				this.anchorKey = key;
				if (keys) {
					const raws = new Map(this.screenRows.map((r) => [taskKey(r.task), r.task.raw]));
					for (const k of keys) {
						const raw = raws.get(k);
						if (on && raw !== undefined) this.selected.set(k, raw);
						else this.selected.delete(k);
					}
					this.render();
					return;
				}
				if (on) this.selected.set(key, t.raw);
				else this.selected.delete(key);
				this.selectionBar.setCount(this.selected.size);
				// Group, column and day checkboxes show all, some or none; updated in place, since a
				// redraw of a large calendar takes a noticeable moment on every tick.
				refreshGroupSelects(this.rootEl, (task) => this.selected.get(taskKey(task)) === task.raw);
			},
			setMany: (tasks, on) => {
				for (const t of tasks) {
					if (on) this.selected.set(taskKey(t), t.raw);
					else this.selected.delete(taskKey(t));
				}
				this.anchorKey = null;
				this.render();
			},
		};
	}

	/** The date field date actions change. */
	protected bulkDateField(): CalendarField {
		return 'due';
	}

	private updateBar(): void {
		this.selectionBar.render({
			active: this.selecting,
			selected: this.selected.size,
			shown: this.shownRows.length,
			dateField: this.bulkDateField(),
			busy: this.batch ? { done: this.batch.done, total: this.batch.total } : null,
			undoLabel: this.lastUndo ? `${this.lastUndo.records.length} ${this.lastUndo.records.length === 1 ? 'task' : 'tasks'}` : null,
			compact: Platform.isPhone,
		});
	}

	private setSelecting(on: boolean): void {
		if (this.batch) return;
		this.selecting = on;
		if (!on) this.selected.clear();
		this.anchorKey = null;
		this.toolbar.setSelecting(on);
		this.rootEl.toggleClass('is-selecting', on);
		void this.renderAsync().then(() => (on ? this.selectionBar.focus() : this.toolbar.focusSelect()));
	}

	private selectAll(): void {
		for (const r of this.shownRows) this.selected.set(taskKey(r.task), r.task.raw);
		this.render();
	}

	/** Copy the selected tasks, in the order they appear on screen, to the clipboard. */
	private async copySelected(mode: CopyMode): Promise<void> {
		const seen = new Set<string>();
		const tasks: IndexedTask[] = [];
		// On-screen order first; then any selected task the filters now hide.
		for (const r of [...this.screenRows, ...this.allRows]) {
			const key = taskKey(r.task);
			if (seen.has(key) || this.selected.get(key) !== r.task.raw) continue;
			seen.add(key);
			tasks.push(r.task);
		}
		if (!tasks.length) return;
		const text = copyText(tasks, mode, (t) => {
			const file = this.app.vault.getAbstractFileByPath(t.path);
			if (!(file instanceof TFile)) return t.path;
			return this.app.fileManager.generateMarkdownLink(file, '', t.blockId ? `#^${t.blockId}` : undefined);
		});
		const n = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
		try {
			await navigator.clipboard.writeText(text);
			new Notice(`Tasklines: copied ${n}${mode === 'lines' ? ' as task lines' : ''}.`);
		} catch {
			new Notice('Tasklines: could not copy to the clipboard.');
		}
	}

	/** Run one action on every selected task: planned, confirmed, then written one line at a time. */
	private async runBulk(choice: BulkAction | { kind: 'pick-date'; field: CalendarField }, verb: string): Promise<void> {
		if (this.batch) return;
		let action: BulkAction;
		if (choice.kind === 'pick-date') {
			const picked = await new Promise<string | undefined>((resolve) => new DatePickModal(this.app, undefined, resolve).open());
			if (picked === undefined) return;
			action = { kind: 'set-date', field: choice.field, value: picked };
			verb = verb.replace(/ on$/, ` to ${picked} on`);
		} else action = choice;
		const ctx = await this.writer.batchContext();
		// Today and Tomorrow mean the day the batch runs.
		if (action.kind === 'set-date' && (action.value === 'today' || action.value === 'tomorrow')) {
			action = { ...action, value: action.value === 'today' ? ctx.today : addDays(ctx.today, 1) };
		}
		// The tasks as selected: same key and same line text as when they were ticked.
		const tasks: IndexedTask[] = [];
		const seen = new Set<string>();
		for (const r of this.allRows) {
			const key = taskKey(r.task);
			if (seen.has(key) || this.selected.get(key) !== r.task.raw) continue;
			seen.add(key);
			tasks.push(r.task);
		}
		if (!tasks.length) return;
		const plan = planBulk(tasks, action, ctx.today);
		const confirmVerb = action.kind === 'complete' ? 'Complete' : action.kind === 'reopen' ? 'Reopen' : 'Change';
		const desc = describePlan(confirmVerb, plan);
		const outcomes: Array<{ outcome: StepOutcome; reason?: string; toggle?: boolean }> = [];
		for (const s of plan) {
			if (s.op.kind === 'skip') outcomes.push({ outcome: 'skipped', reason: s.op.reason });
			if (s.op.kind === 'refuse') outcomes.push({ outcome: 'refused', reason: s.op.reason });
		}
		if (desc.writes === 0) {
			new Notice(`Tasklines: ${describeSummary(verb, tasks.length, summarizeBatch(outcomes))}`, 8000);
			return;
		}
		// Large batches, and any that can't be fully undone, ask first.
		if ((desc.writes > 20 || desc.toggles > 0) && !(await confirmModal(this.app, desc.text, confirmVerb))) return;

		const steps = orderForWrite(plan.filter((s) => s.op.kind === 'edit' || s.op.kind === 'toggle'));
		const batch = { cancel: false, done: 0, total: steps.length };
		this.batch = batch;
		this.lastUndo = null;
		this.updateBar();
		const records: UndoRecord[] = [];
		const touched = new Set<string>();
		try {
			for (const step of steps) {
				const { task, op } = step;
				if (batch.cancel) {
					outcomes.push({ outcome: 'skipped', reason: 'cancelled' });
					continue;
				}
				if (op.kind !== 'edit' && op.kind !== 'toggle') continue;
				const target = { path: task.path, line: task.line, raw: task.raw };
				const res = await this.writer.applyStep(target, op.kind === 'toggle' ? { kind: 'toggle' } : { kind: 'edit', edit: op.edit }, ctx);
				if (res.status === 'written') {
					touched.add(task.path);
					outcomes.push({ outcome: 'written', toggle: op.kind === 'toggle' });
					if (op.kind === 'toggle') shiftRecords(records, task.path, task.line, res.lines.length);
					else if (res.lines[0] !== undefined) records.push({ path: task.path, line: task.line, written: res.lines[0], original: task.raw });
				} else if (res.status === 'unchanged') outcomes.push({ outcome: 'skipped', reason: 'nothing to change' });
				else if (res.status === 'refused') {
					touched.add(task.path);
					outcomes.push({ outcome: 'refused', reason: res.message });
				} else outcomes.push({ outcome: 'failed', reason: res.message });
				batch.done++;
				this.updateBar();
			}
		} finally {
			this.batch = null;
			this.writer.refresh(touched);
			this.selected.clear();
			this.anchorKey = null;
			this.lastUndo = records.length ? { label: verb.replace(/:$/, ''), records } : null;
			this.refreshAfterBatch = false;
			await this.renderAsync();
			this.selectionBar.focus();
		}
		this.reportBatch(describeSummary(verb, tasks.length, summarizeBatch(outcomes)), records.length > 0);
	}

	private reportBatch(text: string, undoable: boolean): void {
		const message = new DocumentFragment();
		message.createDiv({ text: `Tasklines: ${text}` });
		if (undoable) {
			const undo = message.createEl('button', { text: 'Undo', cls: 'tasklines-notice-btn' });
			const notice = new Notice(message, 15000);
			this.undoNotice = notice;
			undo.addEventListener('click', () => {
				notice.hide();
				void this.runUndo();
			});
		} else new Notice(message, 10000);
	}

	/** Put back every line the last batch wrote, each only if it is still what the batch wrote. */
	private async runUndo(): Promise<void> {
		const last = this.lastUndo;
		if (!last || this.batch) return;
		this.lastUndo = null;
		const batch = { cancel: false, done: 0, total: last.records.length };
		this.batch = batch;
		this.updateBar();
		let restored = 0;
		const failed: string[] = [];
		try {
			for (const r of [...last.records].reverse()) {
				const res = await this.writer.restoreQuiet({ path: r.path, line: r.line, raw: r.written }, r.original);
				if (res.status === 'written') restored++;
				else if (res.status === 'refused' || res.status === 'missing' || res.status === 'error' || res.status === 'busy') failed.push(res.message);
				batch.done++;
				this.updateBar();
			}
		} finally {
			this.batch = null;
			this.writer.refresh(last.records.map((r) => r.path));
			this.refreshAfterBatch = false;
			await this.renderAsync();
		}
		const total = last.records.length;
		new Notice(
			`Tasklines: undid ${restored} of ${total} ${total === 1 ? 'change' : 'changes'}.` +
				(failed.length ? ` ${failed.length} could not be put back: ${[...new Set(failed)].join(' ')}` : ''),
			10000,
		);
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
		const groups = applyQuery(rows, this.query, today);
		// A task can appear in several tag groups; select it once.
		this.shownRows = [...new Map(groups.flatMap((g) => g.rows).map((r) => [taskKey(r.task), r])).values()];
		// Subgroups reorder rows inside their group; ranges follow what is on screen.
		const onScreen = groups.flatMap((g) => (g.subgroups ? g.subgroups.flatMap((s) => s.rows) : g.rows));
		this.screenRows = [...new Map(onScreen.map((r) => [taskKey(r.task), r])).values()];
		renderRows(this.statsEl, this.list, {
			selection: this.selectionHooks(),
			tint: this.tint(today),
			groups,
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
		return { ...this.query, group: 'none', subgroup: 'none' };
	}

	protected draw(rows: ViewRow[], tasksByPath: Map<string, IndexedTask[]>, today: string): void {
		const field = normalizeBoardField(this.config.get(BOARD_FIELD_KEY));
		const sorted = applyQuery(rows, this.effectiveQuery(), today).flatMap((g) => g.rows);
		this.shownRows = sorted;
		const columns = boardColumns(sorted, field, today);
		this.screenRows = [...new Map(columns.flatMap((c) => c.rows).map((r) => [taskKey(r.task), r])).values()];
		this.board.render({
			selection: this.selectionHooks(),
			tint: this.tint(today),
			columns,
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

	protected bulkDateField(): CalendarField {
		return normalizeCalendarField(this.config.get(CALENDAR_FIELD_KEY));
	}

	protected effectiveQuery(): TaskQuery {
		// Days take the place of groups; a group saved from a list view must not apply.
		return { ...this.query, group: 'none', subgroup: 'none' };
	}

	protected draw(rows: ViewRow[], tasksByPath: Map<string, IndexedTask[]>, today: string): void {
		const field = normalizeCalendarField(this.config.get(CALENDAR_FIELD_KEY));
		this.shownRows = applyQuery(rows, this.effectiveQuery(), today).flatMap((g) => g.rows);
		// Day by day, as the month and the agenda show them; tasks with no real date last.
		const day = (r: ViewRow) => {
			const d = r.task[field];
			return d && isRealDate(d) ? d : '9999';
		};
		this.screenRows = this.shownRows.map((r, i) => ({ r, i })).sort((a, b) => (day(a.r) < day(b.r) ? -1 : day(a.r) > day(b.r) ? 1 : a.i - b.i)).map((x) => x.r);
		this.calendar.render({
			selection: this.selectionHooks(),
			tint: this.tint(today),
			rows: this.shownRows,
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

const taskKey = (t: { path: string; line: number }) => `${t.path}\n${t.line}`;

/** Ask before a large batch, or one that can't be fully undone. Resolves true to go ahead. */
function confirmModal(app: Plugin['app'], text: string, verb: string): Promise<boolean> {
	return new Promise((resolve) => {
		let answered = false;
		const modal = new (class extends Modal {
			onOpen(): void {
				this.setTitle('Change several tasks');
				this.contentEl.createEl('p', { text });
				const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
				const go = buttons.createEl('button', { text: verb, cls: 'mod-cta' });
				const cancel = buttons.createEl('button', { text: 'Cancel' });
				go.addEventListener('click', () => {
					answered = true;
					this.close();
				});
				cancel.addEventListener('click', () => this.close());
				window.setTimeout(() => go.focus(), 0);
			}
			onClose(): void {
				this.contentEl.empty();
				resolve(answered);
			}
		})(app);
		modal.open();
	});
}
