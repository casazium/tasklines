// DOM rendering for task rows. Uses only types from Obsidian; all Bases API calls
// are made in bases-adapter.ts and passed in as callbacks.

import type { BasesPropertyId, TFile, Value } from 'obsidian';
import type { TaskColumn } from './columns.ts';
import type { IndexStats } from './indexer.ts';
import { statusKind } from './parser.ts';
import type { QueryRow, RowGroup } from './query.ts';
import type { VirtualList } from './virtual-list.ts';

export interface RowSource {
	file: TFile;
	values: Map<string, Value | null>;
}

export interface ViewRow extends QueryRow {
	entry: RowSource;
}

export interface RenderInput {
	groups: RowGroup<ViewRow>[];
	/** Total tasks before task-level filters, for the "N hidden" count. */
	total: number;
	columns: BasesPropertyId[];
	columnNames: string[];
	taskColumns: TaskColumn[];
	stats: IndexStats;
	openTask: (path: string, line: number, newTab: boolean) => void;
	renderValue: (el: HTMLElement, entry: RowSource, prop: BasesPropertyId) => void;
}

type Item = { kind: 'group'; label: string; count: number } | { kind: 'row'; row: ViewRow };

export function renderTaskRows(statsEl: HTMLElement, list: VirtualList, input: RenderInput): void {
	const shown = input.groups.reduce((n, g) => n + g.rows.length, 0);
	const hidden = input.total - shown;
	const s = input.stats;
	statsEl.setText(
		`${shown} tasks${hidden > 0 ? ` (${hidden} filtered out)` : ''} · ${s.filesSeen} notes ` +
			`(${s.filesRead} read, ${s.cacheHits} cached, ${s.filesSkippedNoTasks} without tasks) · ${s.ms.toFixed(0)} ms`,
	);

	const items: Item[] = [];
	for (const g of input.groups) {
		if (g.label !== null) items.push({ kind: 'group', label: g.label, count: g.rows.length });
		for (const row of g.rows) items.push({ kind: 'row', row });
	}

	// Columns: task text, chosen task columns, then the base's note-property columns.
	const colCount = 1 + input.taskColumns.length + input.columns.length;
	list.scroller.style.setProperty('--task-rows-cols', `minmax(16em, 3fr) repeat(${colCount - 1}, minmax(7em, 1fr))`);
	list.header.empty();
	if (items.length === 0) {
		list.header.createDiv({
			cls: 'task-rows-empty',
			text: input.total === 0 ? 'No checkbox tasks in the notes this base selects.' : 'No tasks match the current filters.',
		});
		list.setItems(0, () => {});
		return;
	}
	const head = list.header.createDiv({ cls: 'task-rows-grid task-rows-head', attr: { role: 'row' } });
	head.createDiv({ text: 'Task', attr: { role: 'columnheader' } });
	for (const c of input.taskColumns) head.createDiv({ text: c.label, attr: { role: 'columnheader' } });
	for (const name of input.columnNames) head.createDiv({ text: name, attr: { role: 'columnheader' } });

	list.setItems(items.length, (i, el) => {
		const item = items[i];
		if (!item) return;
		if (item.kind === 'group') {
			el.addClass('task-rows-group');
			el.setText(`${item.label || '(none)'} · ${item.count}`);
			return;
		}
		renderRow(el, item.row, input);
	});
}

function renderRow(el: HTMLElement, row: ViewRow, input: RenderInput): void {
	const { task } = row;
	el.addClasses(['task-rows-grid', 'task-rows-row', `task-rows-status-${statusKind(task.status)}`]);
	el.setAttr('role', 'row');
	const textCell = el.createDiv({ cls: 'task-rows-text', attr: { role: 'cell' } });
	textCell.style.paddingInlineStart = `calc(8px + ${task.depth * 1.25}em)`;
	const link = textCell.createEl('a', { text: task.text || '(empty)', href: '#', cls: 'task-rows-open', attr: { title: task.text } });
	link.setAttr('aria-label', `${task.text} — open ${task.path} at line ${task.line + 1}`);
	link.addEventListener('click', (ev) => {
		ev.preventDefault();
		input.openTask(task.path, task.line, ev.metaKey || ev.ctrlKey);
	});
	for (const c of input.taskColumns) {
		el.createDiv({ cls: `task-rows-col-${c.key}`, text: c.key === 'status' ? `[${task.status}]` : c.value(task), attr: { role: 'cell' } });
	}
	for (const prop of input.columns) input.renderValue(el.createDiv({ cls: 'task-rows-prop', attr: { role: 'cell' } }), row.entry, prop);
}

/** YYYY-MM-DD in local time; toISOString would use UTC and shift "today" near midnight. */
export function localDate(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
