// DOM rendering for task rows. Uses only types from Obsidian; all Bases API calls
// are made in bases-adapter.ts and passed in as callbacks.

import type { BasesPropertyId, TFile, Value } from 'obsidian';
import type { IndexedTask, IndexStats } from './indexer';
import { statusKind, Priority } from './parser';

export interface RowSource {
	file: TFile;
	values: Map<string, Value | null>;
}

export interface ViewSettings {
	hideCompleted: boolean;
	textFilter: string;
	taskSort: string;
	taskGroup: string;
}

export interface RenderInput {
	groups: Array<{ label: string; entries: RowSource[] }>;
	columns: BasesPropertyId[];
	columnNames: string[];
	settings: ViewSettings;
	tasksByPath: Map<string, IndexedTask[]>;
	stats: IndexStats;
	openTask: (path: string, line: number) => void;
	renderValue: (el: HTMLElement, entry: RowSource, prop: BasesPropertyId) => void;
}

interface Row {
	task: IndexedTask;
	entry: RowSource;
	baseGroup: string;
}

const PRIORITY_RANK: Record<Priority, number> = { highest: 0, high: 1, medium: 2, none: 3, low: 4, lowest: 5 };
const MAX_ROWS = 2000; // spike only: cap DOM size until virtualisation lands

export function renderTaskRows(root: HTMLElement, input: RenderInput): void {
	root.empty();
	const { settings } = input;
	const needle = settings.textFilter.trim().toLowerCase();

	let rows: Row[] = [];
	for (const group of input.groups) {
		for (const entry of group.entries) {
			for (const task of input.tasksByPath.get(entry.file.path) ?? []) {
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
	root.createDiv({
		cls: 'task-rows-stats',
		text: `${rows.length} tasks · ${s.filesSeen} notes (${s.filesRead} read, ${s.cacheHits} cached, ${s.filesSkippedNoTasks} without tasks) · indexed in ${s.ms.toFixed(0)} ms`,
	});

	let rendered = 0;
	for (const [label, groupRowsList] of grouped) {
		if (rendered >= MAX_ROWS) break;
		if (label !== null) root.createEl('h4', { cls: 'task-rows-group', text: `${label || '(none)'} · ${groupRowsList.length}` });
		const table = root.createEl('table', { cls: 'task-rows-table' });
		const head = table.createEl('thead').createEl('tr');
		for (const h of ['', 'Task', 'Due', 'Priority', 'Note', ...input.columnNames]) head.createEl('th', { text: h });
		const body = table.createEl('tbody');
		for (const row of groupRowsList) {
			if (rendered++ >= MAX_ROWS) break;
			const tr = body.createEl('tr', { cls: `task-rows-status-${statusKind(row.task.status)}` });
			tr.createEl('td', { cls: 'task-rows-status', text: `[${row.task.status}]` });
			const textCell = tr.createEl('td');
			const link = textCell.createEl('a', { text: row.task.text || '(empty)', href: '#' });
			link.style.paddingLeft = `${row.task.parentLine !== undefined ? 1.2 : 0}em`;
			link.addEventListener('click', (ev) => {
				ev.preventDefault();
				input.openTask(row.task.path, row.task.line);
			});
			tr.createEl('td', { text: row.task.due ?? '' });
			tr.createEl('td', { text: row.task.priority === 'none' ? '' : row.task.priority });
			tr.createEl('td', { text: row.entry.file.basename });
			for (const prop of input.columns) input.renderValue(tr.createEl('td'), row.entry, prop);
		}
	}
	if (rendered > MAX_ROWS) root.createDiv({ cls: 'task-rows-stats', text: `Showing first ${MAX_ROWS} tasks.` });
}

function stableSort(rows: Row[], key: string): Row[] {
	if (key === 'file') return rows;
	const cmp = (a: Row, b: Row): number => {
		switch (key) {
			case 'due':
				return (a.task.due ?? '9999').localeCompare(b.task.due ?? '9999');
			case 'priority':
				return PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority];
			case 'status':
				return a.task.status.localeCompare(b.task.status);
			default:
				return 0;
		}
	};
	return rows.map((r, i) => ({ r, i })).sort((x, y) => cmp(x.r, y.r) || x.i - y.i).map((x) => x.r);
}

function groupRows(rows: Row[], key: string): Map<string | null, Row[]> {
	const out = new Map<string | null, Row[]>();
	const today = new Date().toISOString().slice(0, 10);
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
