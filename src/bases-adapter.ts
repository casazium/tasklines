// The only module that touches the Obsidian Bases API (BasesView, BasesEntry,
// BasesViewConfig, Value, registerBasesView). If the Bases API changes, change this file.

import {
	BasesAllOptions,
	BasesEntry,
	BasesPropertyId,
	BasesView,
	debounce,
	Notice,
	Platform,
	NullValue,
	Plugin,
	QueryController,
	TFile,
	type Value,
} from 'obsidian';
import { AddTaskModal } from './add-task-modal.ts';
import { columnOptionKey, TASK_COLUMNS, type ColumnContext } from './columns.ts';
import type { IndexedTask } from './extract.ts';
import { ALL_PATHS, type TaskIndex } from './indexer.ts';
import type { TaskWriter } from './writer.ts';
import { applyQuery, normalizeQuery, summarize, type TaskQuery } from './query.ts';
import { TaskToolbar, type PropChoice } from './toolbar.ts';
import { localDate, renderRows, type RowSource, type ViewRow } from './view.ts';
import { ROW_HEIGHT, TOUCH_ROW_HEIGHT, VirtualList } from './virtual-list.ts';

export const VIEW_TYPE = 'tasklines';
const QUERY_KEY = 'taskQuery';

export function registerTasklinesView(plugin: Plugin, index: TaskIndex, writer: TaskWriter): boolean {
	return plugin.registerBasesView(VIEW_TYPE, {
		name: 'Tasklines',
		icon: 'lucide-list-checks',
		factory: (controller, containerEl) => new TasklinesView(controller, containerEl, index, writer),
		options: () => viewOptions(),
	});
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

class TasklinesView extends BasesView {
	readonly type = VIEW_TYPE;
	private index: TaskIndex;
	private writer: TaskWriter;
	private rootEl: HTMLElement;
	private toolbar: TaskToolbar;
	private statsEl: HTMLElement;
	private list: VirtualList;
	private query: TaskQuery = normalizeQuery(null);
	private notes: NoteSnapshot[] = [];
	private paths = new Set<string>();
	private renderToken = 0;
	private unsubscribe: (() => void) | null = null;
	private rerenderSoon = debounce(
		() => {
			// `this.data` is still the current result (no onDataUpdated since), so re-reading it is safe.
			this.snapshot();
			this.render();
		},
		300,
		true,
	);

	constructor(controller: QueryController, parentEl: HTMLElement, index: TaskIndex, writer: TaskWriter) {
		super(controller);
		this.index = index;
		this.writer = writer;
		this.rootEl = parentEl.createDiv({ cls: 'tasklines-view' });
		this.toolbar = new TaskToolbar(this.rootEl, this.query, (q) => this.onQueryChange(q), () => this.openAddTask());
		this.statsEl = this.rootEl.createDiv({ cls: 'tasklines-stats' });
		this.list = new VirtualList(this.rootEl, Platform.isMobile ? TOUCH_ROW_HEIGHT : ROW_HEIGHT);
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
	}

	onunload(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.rerenderSoon.cancel();
		this.list.destroy();
		this.notes = [];
	}

	onDataUpdated(): void {
		this.query = normalizeQuery(this.config.get(QUERY_KEY));
		this.rootEl.toggleClass('tasklines-no-toolbar', this.config.get('showToolbar') === false);
		this.toolbar.update(this.query, this.propChoices());
		this.snapshot();
		this.render();
	}

	private onQueryChange(q: TaskQuery): void {
		this.query = q;
		// Saved in the .base file so each view keeps its own preset.
		this.config.set(QUERY_KEY, q);
		// A new sort or group key may need property values we did not resolve yet.
		this.snapshot();
		this.render();
	}

	/**
	 * Copy what we need from `this.data` now. It and its entries are replaced on every
	 * update, so no entry objects are kept across updates.
	 */
	private snapshot(): void {
		const props = new Set<BasesPropertyId>(this.config.getOrder());
		for (const key of [...this.query.sort.map((s) => s.key), this.query.group]) {
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

	private render(): void {
		void this.renderAsync();
	}

	private async renderAsync(): Promise<void> {
		const notes = this.notes;
		const query = this.query;
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
		const columns = this.config.getOrder().filter((p) => p !== 'file.name');
		const today = localDate(new Date());
		const context = columnContext(tasksByPath, today);
		renderRows(this.statsEl, this.list, {
			groups: applyQuery(rows, query, today),
			context,
			total: rows.length,
			columns,
			columnNames: columns.map((p) => this.config.getDisplayName(p)),
			taskColumns: TASK_COLUMNS.filter((c) => {
				const v = this.config.get(columnOptionKey(c.key));
				return typeof v === 'boolean' ? v : c.defaultOn;
			}),
			stats: this.index.lastStats,
			// Notes known to have no tasks are skipped before indexing, so count from all paths.
			notes: { total: this.paths.size, withTasks: [...tasksByPath.values()].filter((t) => t.length > 0).length },
			openTask: (path, line, newTab) => this.openTask(path, line, newTab),
			toggleTask: (task) => this.writer.toggle({ path: task.path, line: task.line, raw: task.raw }),
			tasksPluginAvailable: this.writer.tasksPluginAvailable(),
			editTask: (task, edit) => this.writer.edit({ path: task.path, line: task.line, raw: task.raw }, edit),
			renderValue: (el, entry, prop) => {
				const value = entry.values.get(prop);
				if (value && !(value instanceof NullValue)) value.renderTo(el, this.app.renderContext);
			},
		});
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

	private openTask(path: string, line: number, newTab: boolean): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file, { eState: { line } });
	}
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
