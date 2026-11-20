// Task-level columns. Note-level columns come from the Bases Properties menu instead.

import type { IndexedTask } from './extract.ts';
import { statusKind, statusName } from './parser.ts';
import { daysBetween } from './query.ts';

export type CellEditor = 'status' | 'date' | 'priority';

export interface ColumnContext {
	today: string;
	/** Another task in the same note, by line. */
	taskAt: (path: string, line: number) => IndexedTask | undefined;
	/** Done and total tasks in a note. */
	noteProgress: (path: string) => { done: number; total: number };
}

export interface TaskColumn {
	key: string;
	label: string;
	/** Shown by default in a new view. */
	defaultOn: boolean;
	/** Click-to-edit control, if the column can be edited in place. */
	editor?: CellEditor;
	value: (t: IndexedTask, ctx: ColumnContext) => string;
}

const isOpen = (t: IndexedTask) => !['done', 'cancelled'].includes(statusKind(t.status));

export const TASK_COLUMNS: TaskColumn[] = [
	{ key: 'status', label: 'Status', defaultOn: true, editor: 'status', value: (t) => statusName(t.status) },
	{ key: 'due', label: 'Due', defaultOn: true, editor: 'date', value: (t) => t.due ?? '' },
	{ key: 'priority', label: 'Priority', defaultOn: true, editor: 'priority', value: (t) => (t.priority === 'none' ? '' : t.priority) },
	{ key: 'scheduled', label: 'Scheduled', defaultOn: false, editor: 'date', value: (t) => t.scheduled ?? '' },
	{ key: 'start', label: 'Start', defaultOn: false, editor: 'date', value: (t) => t.start ?? '' },
	{ key: 'created', label: 'Created', defaultOn: false, value: (t) => t.created ?? '' },
	{ key: 'done', label: 'Done', defaultOn: false, value: (t) => t.done ?? '' },
	{ key: 'recurrence', label: 'Recurrence', defaultOn: false, value: (t) => t.recurrence ?? '' },
	{ key: 'tags', label: 'Tags', defaultOn: false, value: (t) => t.tags.join(' ') },
	{ key: 'section', label: 'Section', defaultOn: false, value: (t) => t.section ?? '' },
	{ key: 'line', label: 'Line', defaultOn: false, value: (t) => String(t.line + 1) },
	{ key: 'note', label: 'Note', defaultOn: true, value: (t) => t.path.replace(/^.*\//, '').replace(/\.md$/, '') },
	// Computed columns.
	{
		key: 'overdue',
		label: 'Overdue',
		defaultOn: false,
		value: (t, c) => (t.due && t.due < c.today && isOpen(t) ? `${daysBetween(t.due, c.today)}d` : ''),
	},
	{
		key: 'daysUntilDue',
		label: 'Days until due',
		defaultOn: false,
		value: (t, c) => (t.due && isOpen(t) ? String(daysBetween(c.today, t.due)) : ''),
	},
	{ key: 'age', label: 'Age (days)', defaultOn: false, value: (t, c) => (t.created ? String(daysBetween(t.created, t.done ?? c.today)) : '') },
	{
		key: 'subtasks',
		label: 'Subtasks',
		defaultOn: false,
		value: (t, c) => {
			if (!t.children.length) return '';
			const done = t.children.filter((l) => {
				const child = c.taskAt(t.path, l);
				return child && !isOpen(child);
			}).length;
			return `${done}/${t.children.length}`;
		},
	},
	{
		key: 'noteProgress',
		label: 'Note progress',
		defaultOn: false,
		value: (t, c) => {
			const p = c.noteProgress(t.path);
			return p.total ? `${p.done}/${p.total} (${Math.round((100 * p.done) / p.total)}%)` : '';
		},
	},
];

/** Option key used in the .base view config for a task column toggle. */
export const columnOptionKey = (key: string): string => `taskCol_${key}`;
