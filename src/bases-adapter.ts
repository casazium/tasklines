// The only module that touches the Obsidian Bases API (BasesView, BasesEntry,
// BasesViewConfig, Value, registerBasesView). If the Bases API changes, change this file.

import { BasesAllOptions, BasesEntry, BasesPropertyId, BasesView, Plugin, QueryController, TFile } from 'obsidian';
import type { TaskIndex } from './indexer';
import { renderTaskRows, RowSource, ViewSettings } from './view';

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
						status: 'Status',
						due: 'Due bucket',
						priority: 'Priority',
						none: 'No grouping',
					},
				},
			],
		},
	];
}

class TaskRowsView extends BasesView {
	readonly type = VIEW_TYPE;
	private rootEl: HTMLElement;
	private renderToken = 0;

	constructor(controller: QueryController, parentEl: HTMLElement, private index: TaskIndex) {
		super(controller);
		this.rootEl = parentEl.createDiv({ cls: 'task-rows-view' });
	}

	onDataUpdated(): void {
		// `this.data` and its entries are replaced on every update: copy what we need now,
		// never keep references across updates.
		const token = ++this.renderToken;
		const groups = this.data.groupedData.map((g) => ({
			label: g.hasKey() ? (g.key?.toString() ?? '') : '',
			entries: g.entries.map((e) => this.snapshotEntry(e)),
		}));
		const columns = this.config.getOrder().filter((p) => p !== 'file.name');
		const columnNames = columns.map((p) => this.config.getDisplayName(p));
		const settings: ViewSettings = {
			hideCompleted: this.config.get('hideCompleted') === true,
			textFilter: this.str('textFilter', ''),
			taskSort: this.str('taskSort', 'file'),
			taskGroup: this.str('taskGroup', 'bases'),
		};
		const files = groups.flatMap((g) => g.entries.map((e) => e.file));

		void this.index.tasksFor(files).then((tasksByPath) => {
			if (token !== this.renderToken) return; // a newer update superseded this one
			renderTaskRows(this.rootEl, {
				groups,
				columns,
				columnNames,
				settings,
				tasksByPath,
				stats: this.index.lastStats,
				openTask: (path, line) => this.openTask(path, line),
				renderValue: (el, entry, prop) => this.renderValue(el, entry, prop),
			});
		});
	}

	private str(key: string, fallback: string): string {
		const v = this.config.get(key);
		return typeof v === 'string' ? v : fallback;
	}

	private snapshotEntry(entry: BasesEntry): RowSource {
		// Resolve every visible property now, while the entry object is valid.
		const values = new Map<string, ReturnType<BasesEntry['getValue']>>();
		for (const prop of this.config.getOrder()) values.set(prop, entry.getValue(prop));
		return { file: entry.file, values };
	}

	private renderValue(el: HTMLElement, entry: RowSource, prop: BasesPropertyId): void {
		const value = entry.values.get(prop);
		if (!value || !value.isTruthy()) return;
		value.renderTo(el, this.app.renderContext);
	}

	private openTask(path: string, line: number): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		void this.app.workspace.getLeaf(false).openFile(file, { eState: { line } });
	}
}
