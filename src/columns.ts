// Task-level columns. Note-level columns come from the Bases Properties menu instead.

import type { IndexedTask } from './extract.ts';

export interface TaskColumn {
	key: string;
	label: string;
	/** Shown by default in a new view. */
	defaultOn: boolean;
	value: (t: IndexedTask) => string;
}

export const TASK_COLUMNS: TaskColumn[] = [
	{ key: 'status', label: 'Status', defaultOn: true, value: (t) => t.status },
	{ key: 'due', label: 'Due', defaultOn: true, value: (t) => t.due ?? '' },
	{ key: 'priority', label: 'Priority', defaultOn: true, value: (t) => (t.priority === 'none' ? '' : t.priority) },
	{ key: 'scheduled', label: 'Scheduled', defaultOn: false, value: (t) => t.scheduled ?? '' },
	{ key: 'start', label: 'Start', defaultOn: false, value: (t) => t.start ?? '' },
	{ key: 'created', label: 'Created', defaultOn: false, value: (t) => t.created ?? '' },
	{ key: 'done', label: 'Done', defaultOn: false, value: (t) => t.done ?? '' },
	{ key: 'recurrence', label: 'Recurrence', defaultOn: false, value: (t) => t.recurrence ?? '' },
	{ key: 'tags', label: 'Tags', defaultOn: false, value: (t) => t.tags.join(' ') },
	{ key: 'section', label: 'Section', defaultOn: false, value: (t) => t.section ?? '' },
	{ key: 'line', label: 'Line', defaultOn: false, value: (t) => String(t.line + 1) },
	{ key: 'note', label: 'Note', defaultOn: true, value: (t) => t.path.replace(/^.*\//, '').replace(/\.md$/, '') },
];

/** Option key used in the .base view config for a task column toggle. */
export const columnOptionKey = (key: string): string => `taskCol_${key}`;
