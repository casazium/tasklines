// DOM rendering for task rows. Uses only types from Obsidian; all Bases API calls
// are made in bases-adapter.ts and passed in as callbacks.

import type { BasesPropertyId, TFile, Value } from 'obsidian';
import type { ColumnContext, TaskColumn } from './columns.ts';
import type { TaskEdit } from './edit.ts';
import type { IndexStats } from './indexer.ts';
import { statusDefs, statusKind, statusName } from './parser.ts';
import { formatSummary, PRIORITY_ORDER, summarize, type QueryRow, type RowGroup } from './query.ts';
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
	/** Total tasks before task-level filters, for the "N filtered out" count. */
	total: number;
	columns: BasesPropertyId[];
	columnNames: string[];
	taskColumns: TaskColumn[];
	context: ColumnContext;
	stats: IndexStats;
	/** All notes the base selects, and how many of them have at least one task. */
	notes: { total: number; withTasks: number };
	openTask: (path: string, line: number, newTab: boolean) => void;
	/** Toggle a task in its note; resolves true if the note changed. */
	toggleTask: (task: QueryRow['task']) => Promise<boolean>;
	/** Change one field of a task in its note. */
	editTask: (task: QueryRow['task'], edit: TaskEdit) => Promise<boolean>;
	renderValue: (el: HTMLElement, entry: RowSource, prop: BasesPropertyId) => void;
	/** Whether the Tasks plugin can complete recurring tasks right now. */
	tasksPluginAvailable: boolean;
}

type Item = { kind: 'group'; label: string; summary: string } | { kind: 'row'; row: ViewRow };

export function renderRows(statsEl: HTMLElement, list: VirtualList, input: RenderInput): void {
	const today = input.context.today;
	const shownRows = input.groups.flatMap((g) => g.rows);
	const shown = new Set(shownRows).size; // a task can appear in several tag groups
	const hidden = input.total - shown;
	const s = input.stats;
	statsEl.empty();
	statsEl.createSpan({ cls: 'tasklines-summary', text: formatSummary(summarize([...new Set(shownRows)], today)) });
	statsEl.createSpan({
		text:
			`${hidden > 0 ? ` · ${hidden} filtered out` : ''} · ${input.notes.total} notes ` +
			`(${input.notes.total - input.notes.withTasks} without tasks; ${s.filesRead} read, ${s.cacheHits} cached) · ${s.ms.toFixed(0)} ms`,
	});

	const items: Item[] = [];
	for (const g of input.groups) {
		if (g.label !== null) items.push({ kind: 'group', label: g.label, summary: formatSummary(summarize(g.rows, today)) });
		for (const row of g.rows) items.push({ kind: 'row', row });
	}

	// Columns: task text, chosen task columns, then the base's note-property columns.
	const colCount = 1 + input.taskColumns.length + input.columns.length;
	list.scroller.setCssProps({ '--tasklines-cols': `minmax(16em, 3fr) repeat(${colCount - 1}, minmax(7em, 1fr))` });
	list.header.empty();
	if (items.length === 0) {
		list.header.createDiv({
			cls: 'tasklines-empty',
			text: input.total === 0 ? 'No checkbox tasks in the notes this base selects.' : 'No tasks match the current filters.',
		});
		list.setItems(0, () => {});
		return;
	}
	const head = list.header.createDiv({ cls: 'tasklines-grid tasklines-head', attr: { role: 'row' } });
	head.createDiv({ text: 'Task', attr: { role: 'columnheader' } });
	for (const c of input.taskColumns) head.createDiv({ text: c.label, attr: { role: 'columnheader' } });
	for (const name of input.columnNames) head.createDiv({ text: name, attr: { role: 'columnheader' } });

	list.setItems(items.length, (i, el) => {
		const item = items[i];
		if (!item) return;
		if (item.kind === 'group') {
			el.addClass('tasklines-group');
			el.createSpan({ cls: 'tasklines-group-label', text: item.label || '(none)' });
			el.createSpan({ cls: 'tasklines-group-summary', text: item.summary });
			return;
		}
		renderRow(el, item.row, input);
	});
}

function renderRow(el: HTMLElement, row: ViewRow, input: RenderInput): void {
	const { task } = row;
	const kind = statusKind(task.status);
	el.addClasses(['tasklines-grid', 'tasklines-row', `tasklines-status-${kind}`]);
	el.setAttr('role', 'row');
	const textCell = el.createDiv({ cls: 'tasklines-text', attr: { role: 'cell' } });
	textCell.setCssProps({ '--tasklines-depth': String(task.depth) });
	const box = textCell.createEl('input', {
		type: 'checkbox',
		cls: 'task-list-item-checkbox tasklines-checkbox',
		attr: { 'aria-label': kind === 'done' || kind === 'cancelled' ? `Reopen: ${task.text}` : `Complete: ${task.text}`, 'data-task': task.status },
	});
	const open = kind !== 'done' && kind !== 'cancelled';
	if (task.recurrence && open && !input.tasksPluginAvailable) {
		box.addClass('tasklines-needs-tasks');
		box.setAttr('title', 'Completing a recurring task needs the Tasks plugin (7.2.0 or later). Open the note to complete it there.');
	}
	box.checked = kind !== 'todo';
	box.indeterminate = kind === 'in-progress';
	box.addEventListener('click', (ev) => {
		ev.preventDefault(); // the checkbox shows the note's state, which changes only after the write
		if (box.disabled) return;
		box.disabled = true;
		void (async () => {
			try {
				await input.toggleTask(task);
			} finally {
				box.disabled = false;
			}
		})();
	});
	const link = textCell.createEl('a', { text: task.text || '(empty)', href: '#', cls: 'tasklines-open', attr: { title: task.text } });
	link.setAttr('aria-label', `${task.text} — open ${task.path} at line ${task.line + 1}`);
	if (task.recurrence) {
		textCell.createSpan({ cls: 'tasklines-recurs', text: '🔁', attr: { title: `Repeats ${task.recurrence}`, 'aria-label': `Repeats ${task.recurrence}` } });
	}
	link.addEventListener('click', (ev) => {
		ev.preventDefault();
		input.openTask(task.path, task.line, ev.metaKey || ev.ctrlKey);
	});
	for (const c of input.taskColumns) {
		const cell = el.createDiv({ cls: `tasklines-col-${c.key}`, text: c.value(task, input.context), attr: { role: 'cell' } });
		if (c.editor) makeEditable(cell, c, task, input);
	}
	for (const prop of input.columns) input.renderValue(el.createDiv({ cls: 'tasklines-prop', attr: { role: 'cell' } }), row.entry, prop);
}

/** Click (or Enter) on the cell swaps in an input; change commits, Escape or blur cancels. */
function makeEditable(cell: HTMLElement, column: TaskColumn, task: QueryRow['task'], input: RenderInput): void {
	cell.addClass('tasklines-editable');
	cell.setAttr('tabindex', '0');
	cell.setAttr('aria-label', `Edit ${column.label.toLowerCase()}: ${column.value(task, input.context) || 'empty'}`);
	const open = () => {
		if (cell.querySelector('input, select')) return;
		const shown = cell.getText();
		cell.empty();
		let control: HTMLInputElement | HTMLSelectElement;
		let toEdit: () => TaskEdit | null;
		if (column.editor === 'date') {
			const field = column.key as 'due' | 'scheduled' | 'start';
			const inputEl = cell.createEl('input', { type: 'date', cls: 'tasklines-cell-input' });
			inputEl.value = task[field] ?? '';
			control = inputEl;
			toEdit = () => (inputEl.value === (task[field] ?? '') ? null : { kind: 'date', field, value: inputEl.value || null });
		} else if (column.editor === 'priority') {
			const sel = cell.createEl('select', { cls: 'dropdown tasklines-cell-input' });
			for (const p of PRIORITY_ORDER) sel.createEl('option', { value: p, text: p === 'none' ? '(none)' : p });
			sel.value = task.priority;
			control = sel;
			toEdit = () => (sel.value === task.priority ? null : { kind: 'priority', value: sel.value as typeof task.priority });
		} else {
			const sel = cell.createEl('select', { cls: 'dropdown tasklines-cell-input' });
			const defs = statusDefs();
			if (!defs.some((d) => d.char === task.status)) sel.createEl('option', { value: task.status, text: statusName(task.status) });
			for (const d of defs) sel.createEl('option', { value: d.char, text: `[${d.char}] ${d.name}` });
			sel.value = task.status;
			control = sel;
			toEdit = () => (sel.value === task.status ? null : { kind: 'status', value: sel.value });
		}
		let done = false;
		const close = (commit: boolean) => {
			if (done) return;
			done = true;
			const edit = commit ? toEdit() : null;
			cell.empty();
			cell.setText(shown);
			if (edit) {
				cell.addClass('is-saving');
				void (async () => {
					try {
						await input.editTask(task, edit);
					} finally {
						cell.removeClass('is-saving');
					}
				})();
			}
		};
		control.addEventListener('change', () => close(true));
		control.addEventListener('blur', () => close(false));
		control.addEventListener('keydown', (ev) => {
			const key = (ev as KeyboardEvent).key;
			if (key === 'Escape') close(false);
			if (key === 'Enter') close(true);
		});
		control.focus();
	};
	cell.addEventListener('click', open);
	cell.addEventListener('keydown', (ev) => {
		if (ev.key === 'Enter' || ev.key === ' ') {
			ev.preventDefault();
			open();
		}
	});
}

/** YYYY-MM-DD in local time; toISOString would use UTC and shift "today" near midnight. */
export function localDate(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
