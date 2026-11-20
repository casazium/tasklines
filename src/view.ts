// DOM rendering for task rows. Uses only types from Obsidian; all Bases API calls
// are made in bases-adapter.ts and passed in as callbacks.

import type { BasesPropertyId, TFile, Value } from 'obsidian';
import type { TaskColumn } from './columns.ts';
import type { IndexedTask } from './extract.ts';
import type { IndexStats } from './indexer.ts';
import { statusKind, type Priority } from './parser.ts';

export interface RowSource {
	file: TFile;
	values: Map<string, Value | null>;
}

export interface ViewSettings {
	hideCompleted: boolean;
	textFilter: string;
	taskSort: string;
	taskGroup: string;
	taskColumns: TaskColumn[];
}

export interface RenderInput {
	groups: Array<{ label: string; entries: RowSource[] }>;
	columns: BasesPropertyId[];
	columnNames: string[];
	settings: ViewSettings;
	tasksByPath: Map<string, IndexedTask[]>;
	stats: IndexStats;
	openTask: (path: string, line: number, newTab: boolean) => void;
	renderValue: (el: HTMLElement, entry: RowSource, prop: BasesPropertyId) => void;
}

interface Row {
	task: IndexedTask;
	entry: RowSource;
	baseGroup: string;
}

const PRIORITY_RANK: Record<Priority, number> = { highest: 0, high: 1, medium: 2, none: 3, low: 4, lowest: 5 };
const MAX_ROWS = 2000; // until virtualised rendering lands in milestone 2

export function renderTaskRows(root: HTMLElement, input: RenderInput): void {
	root.empty();
	const { settings } = input;
	const needle = settings.textFilter.trim().toLowerCase();

	let rows: Row[] = [];
	let total = 0;
	for (const group of input.groups) {
		for (const entry of group.entries) {
			for (const task of input.tasksByPath.get(entry.file.path) ?? []) {
				total++;
				const kind = statusKind(task.status);
				if (settings.hideCompleted && (kind === 'done' || kind === 'cancelled')) continue;
				if (needle && !task.text.toLowerCase().includes(needle)) continue;
				rows.push({ task, entry, baseGroup: group.label });
			}
		}
	}

	// Bases has already sorted notes; this sort is stable, so it orders tasks inside that.
	rows = stableSort(rows, settings.taskSort);
	const grouped = groupRows(rows, settings.taskGroup);

	const s = input.stats;
	const hidden = total - rows.length;
	root.createDiv({
		cls: 'task-rows-stats',
		text:
			`${rows.length} tasks${hidden ? ` (${hidden} hidden)` : ''} · ${s.filesSeen} notes ` +
			`(${s.filesRead} read, ${s.cacheHits} cached, ${s.filesSkippedNoTasks} without tasks) · ${s.ms.toFixed(0)} ms`,
	});

	if (rows.length === 0) {
		root.createDiv({
			cls: 'task-rows-empty',
			text: total === 0 ? 'No checkbox tasks in the notes this base selects.' : 'No tasks match the current view settings.',
		});
		return;
	}

	let rendered = 0;
	for (const [label, groupList] of grouped) {
		if (rendered >= MAX_ROWS) break;
		if (label !== null) root.createEl('h4', { cls: 'task-rows-group', text: `${label || '(none)'} · ${groupList.length}` });
		const table = root.createEl('table', { cls: 'task-rows-table' });
		const head = table.createEl('thead').createEl('tr');
		head.createEl('th', { text: 'Task' });
		for (const c of settings.taskColumns) head.createEl('th', { text: c.label });
		for (const name of input.columnNames) head.createEl('th', { text: name });

		const body = table.createEl('tbody');
		for (const row of groupList) {
			if (rendered++ >= MAX_ROWS) break;
			const { task } = row;
			const tr = body.createEl('tr', { cls: `task-rows-row task-rows-status-${statusKind(task.status)}` });
			const textCell = tr.createEl('td', { cls: 'task-rows-text' });
			textCell.style.paddingInlineStart = `calc(8px + ${task.depth * 1.25}em)`;
			const link = textCell.createEl('a', { text: task.text || '(empty)', href: '#', cls: 'task-rows-open' });
			link.setAttr('aria-label', `Open ${task.path} at line ${task.line + 1}`);
			link.addEventListener('click', (ev) => {
				ev.preventDefault();
				input.openTask(task.path, task.line, ev.metaKey || ev.ctrlKey);
			});
			for (const c of settings.taskColumns) {
				tr.createEl('td', { cls: `task-rows-col-${c.key}`, text: c.key === 'status' ? `[${task.status}]` : c.value(task) });
			}
			for (const prop of input.columns) input.renderValue(tr.createEl('td'), row.entry, prop);
		}
	}
	if (rows.length > MAX_ROWS) root.createDiv({ cls: 'task-rows-stats', text: `Showing the first ${MAX_ROWS} of ${rows.length} tasks.` });
}

export function stableSort<T extends { task: IndexedTask }>(rows: T[], key: string): T[] {
	if (key === 'file') return rows;
	const cmp = (a: IndexedTask, b: IndexedTask): number => {
		switch (key) {
			case 'due':
				return (a.due ?? '9999').localeCompare(b.due ?? '9999');
			case 'priority':
				return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
			case 'status':
				return a.status.localeCompare(b.status);
			default:
				return 0;
		}
	};
	return rows.map((r, i) => ({ r, i })).sort((x, y) => cmp(x.r.task, y.r.task) || x.i - y.i).map((x) => x.r);
}

function groupRows(rows: Row[], key: string): Map<string | null, Row[]> {
	const out = new Map<string | null, Row[]>();
	const today = localDate(new Date());
	const keyOf = (r: Row): string | null => {
		switch (key) {
			case 'none':
				return null;
			case 'note':
				return r.entry.file.basename;
			case 'status':
				return statusKind(r.task.status);
			case 'priority':
				return r.task.priority;
			case 'section':
				return r.task.section ?? '';
			case 'due':
				if (!r.task.due) return 'No due date';
				return r.task.due < today ? 'Overdue' : r.task.due === today ? 'Today' : 'Upcoming';
			default:
				return r.baseGroup;
		}
	};
	for (const r of rows) {
		const k = keyOf(r);
		const list = out.get(k);
		if (list) list.push(r);
		else out.set(k, [r]);
	}
	// A single unlabeled Bases group (no groupBy configured) renders without a heading.
	if (key === 'bases' && out.size === 1 && out.has('')) return new Map([[null, out.get('') ?? []]]);
	return out;
}

/** YYYY-MM-DD in local time; toISOString would use UTC and shift "today" near midnight. */
export function localDate(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
