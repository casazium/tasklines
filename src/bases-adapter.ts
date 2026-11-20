// The only module that touches the Obsidian Bases API (BasesView, BasesEntry,
// BasesViewConfig, Value, registerBasesView). If the Bases API changes, change this file.

import { BasesAllOptions, BasesEntry, BasesPropertyId, BasesView, debounce, Plugin, QueryController, RenderContext, TFile } from 'obsidian';
import { columnOptionKey, TASK_COLUMNS } from './columns.ts';
import type { TaskIndex } from './indexer.ts';
import { renderTaskRows, type RowSource, type ViewSettings } from './view.ts';

export const VIEW_TYPE = 'task-rows';

export function registerTaskRowsView(plugin: Plugin, index: TaskIndex): boolean {
	return plugin.registerBasesView(VIEW_TYPE, {
		name: 'Task rows',
		icon: 'lucide-list-checks',
		factory: (controller, containerEl) => new TaskRowsView(controller, containerEl, index),
		options: () => viewOptions(),
	});
}

function viewOptions(): BasesAllOptions[] {
	return [
		{
			type: 'group',
			displayName: 'Tasks',
			items: [
				{ type: 'toggle', key: 'hideCompleted', displayName: 'Hide completed and cancelled', default: false },
				{ type: 'text', key: 'textFilter', displayName: 'Task text contains', placeholder: '' },
				{
					type: 'dropdown',
					key: 'taskSort',
					displayName: 'Sort tasks within a note by',
					default: 'file',
					options: { file: 'Position in note', due: 'Due date', priority: 'Priority', status: 'Status' },
				},
				{
					type: 'dropdown',
					key: 'taskGroup',
					displayName: 'Group tasks by',
					default: 'bases',
					options: {
						bases: 'Bases "Group by" (note level)',
						note: 'Note',
						section: 'Section',
						status: 'Status',
						due: 'Due bucket',
						priority: 'Priority',
						none: 'No grouping',
					},
				},
			],
		},
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

interface Snapshot {
	groups: Array<{ label: string; entries: RowSource[] }>;
	columns: BasesPropertyId[];
	columnNames: string[];
	settings: ViewSettings;
	paths: Set<string>;
}

class TaskRowsView extends BasesView {
	readonly type = VIEW_TYPE;
	private rootEl: HTMLElement;
	private renderToken = 0;
	private snapshot: Snapshot | null = null;
	private unsubscribe: (() => void) | null = null;
	private rerenderSoon = debounce(() => this.render(), 300, true);

	constructor(controller: QueryController, parentEl: HTMLElement, private index: TaskIndex) {
		super(controller);
		this.rootEl = parentEl.createDiv({ cls: 'task-rows-view' });
		// Bases may not call onDataUpdated when only a note's body changes (no property
		// changed), so re-render ourselves when a note in the current result set changes.
		// Subscribed here rather than in onload() because the docs do not say whether
		// Bases loads the view as a child component.
		this.unsubscribe = this.index.onInvalidate((paths) => {
			// If the view was torn down without onunload, stop listening instead of leaking.
			if (!this.rootEl.isConnected && this.snapshot) return this.onunload();
			if (this.snapshot && paths.some((p) => this.snapshot?.paths.has(p))) this.rerenderSoon();
		});
	}

	onunload(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.rerenderSoon.cancel();
		this.snapshot = null;
	}

	onDataUpdated(): void {
		// `this.data` and its entries are replaced on every update: copy what we need now,
		// never keep references to entries across updates.
		const order = this.config.getOrder();
		const groups = this.data.groupedData.map((g) => ({
			label: g.hasKey() ? (g.key?.toString() ?? '') : '',
			entries: g.entries.map((e) => snapshotEntry(e, order)),
		}));
		const columns = order.filter((p) => p !== 'file.name');
		this.snapshot = {
			groups,
			columns,
			columnNames: columns.map((p) => this.config.getDisplayName(p)),
			settings: this.readSettings(),
			paths: new Set(groups.flatMap((g) => g.entries.map((e) => e.file.path))),
		};
		this.render();
	}

	private render(): void {
		const snap = this.snapshot;
		if (!snap) return;
		const token = ++this.renderToken;
		const files = snap.groups.flatMap((g) => g.entries.map((e) => e.file));
		void this.index.tasksFor(files).then((tasksByPath) => {
			if (token !== this.renderToken || snap !== this.snapshot) return; // superseded
			renderTaskRows(this.rootEl, {
				...snap,
				tasksByPath,
				stats: this.index.lastStats,
				openTask: (path, line, newTab) => this.openTask(path, line, newTab),
				renderValue: (el, entry, prop) => renderValue(el, entry, prop, this.app.renderContext),
			});
		});
	}

	private readSettings(): ViewSettings {
		const str = (key: string, fallback: string): string => {
			const v = this.config.get(key);
			return typeof v === 'string' ? v : fallback;
		};
		const bool = (key: string, fallback: boolean): boolean => {
			const v = this.config.get(key);
			return typeof v === 'boolean' ? v : fallback;
		};
		return {
			hideCompleted: bool('hideCompleted', false),
			textFilter: str('textFilter', ''),
			taskSort: str('taskSort', 'file'),
			taskGroup: str('taskGroup', 'bases'),
			taskColumns: TASK_COLUMNS.filter((c) => bool(columnOptionKey(c.key), c.defaultOn)),
		};
	}

	private openTask(path: string, line: number, newTab: boolean): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file, { eState: { line } });
	}
}

function snapshotEntry(entry: BasesEntry, order: BasesPropertyId[]): RowSource {
	// Resolve every visible property now, while the entry object is valid.
	const values = new Map<string, ReturnType<BasesEntry['getValue']>>();
	for (const prop of order) values.set(prop, entry.getValue(prop));
	return { file: entry.file, values };
}

function renderValue(el: HTMLElement, entry: RowSource, prop: BasesPropertyId, ctx: RenderContext): void {
	const value = entry.values.get(prop);
	if (!value || !value.isTruthy()) return;
	value.renderTo(el, ctx);
}
