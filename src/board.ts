// Task board: which column a task belongs in, and what moving it to another column changes.
// Pure: no DOM, no Obsidian runtime. Every move is one existing single-line edit (or the
// same toggle the checkbox uses, for recurring tasks), so the board adds no new way of writing.

import type { TaskEdit } from './edit.ts';
import type { IndexedTask } from './extract.ts';
import { statusDefs, statusKind, type Priority, type StatusKind } from './parser.ts';
import { addDays, PRIORITY_ORDER, STATUS_KINDS, STATUS_LABELS, type QueryRow } from './query.ts';

export const BOARD_FIELDS = ['status', 'priority', 'due'] as const;
export type BoardField = (typeof BOARD_FIELDS)[number];
export const BOARD_FIELD_LABELS: Record<BoardField, string> = { status: 'Status', priority: 'Priority', due: 'Due date' };

/**
 * What a move does. `toggle` completes a recurring task through the checkbox's toggle (so the
 * Tasks plugin creates the next occurrence) and must end done. `blocked` explains a refusal.
 */
export type BoardMove = { kind: 'toggle' } | { kind: 'edit'; edit: TaskEdit } | { kind: 'blocked'; reason: string };

/**
 * Where a column sends a task, or null if it is not a drop target (its meaning is a range).
 * Due targets are days from today, resolved when the move happens, so a board left open past
 * midnight still writes the right date.
 */
export type BoardTarget = { field: 'status'; char: string; statusKind: StatusKind } | { field: 'priority'; value: Priority } | { field: 'due'; daysFromToday: number | null } | null;

export interface BoardColumn<R extends QueryRow = QueryRow> {
	key: string;
	label: string;
	/** Why a column does not accept drops; shown under its title. */
	note?: string;
	target: BoardTarget;
	rows: R[];
}

export function normalizeBoardField(raw: unknown): BoardField {
	return typeof raw === 'string' && (BOARD_FIELDS as readonly string[]).includes(raw) ? (raw as BoardField) : 'status';
}

/** Prefer the core characters, which every tool reads the same way. */
const CORE_CHAR: Partial<Record<StatusKind, string>> = { todo: ' ', 'in-progress': '/', done: 'x', cancelled: '-' };

function charFor(kind: StatusKind): string | null {
	const defs = statusDefs().filter((d) => d.kind === kind);
	const core = CORE_CHAR[kind];
	if (core !== undefined && defs.some((d) => d.char === core)) return core;
	return defs[0]?.char ?? null;
}

type Bucket = Omit<BoardColumn, 'rows'>;

const RANGE_NOTE = 'A range of dates, so tasks cannot be dropped here.';

function buckets(field: BoardField): Bucket[] {
	switch (field) {
		case 'status':
			return STATUS_KINDS.map((kind) => {
				const char = kind === 'other' ? null : charFor(kind);
				return char === null
					? { key: kind, label: STATUS_LABELS[kind], target: null, note: 'Custom statuses differ, so tasks cannot be dropped here. Change them in the Status column or the note.' }
					: { key: kind, label: STATUS_LABELS[kind], target: { field: 'status', char, statusKind: kind } };
			});
		case 'priority':
			return PRIORITY_ORDER.map((p) => ({ key: p, label: p === 'none' ? 'No priority' : (p[0]?.toUpperCase() ?? '') + p.slice(1), target: { field: 'priority', value: p } }));
		case 'due':
			return [
				{ key: 'overdue', label: 'Overdue', target: null, note: 'Drop an overdue task on Today or Tomorrow to reschedule it.' },
				{ key: 'today', label: 'Today', target: { field: 'due', daysFromToday: 0 } },
				{ key: 'tomorrow', label: 'Tomorrow', target: { field: 'due', daysFromToday: 1 } },
				{ key: 'week', label: 'Next 7 days', target: null, note: RANGE_NOTE },
				{ key: 'later', label: 'Later', target: null, note: RANGE_NOTE },
				{ key: 'none', label: 'No due date', target: { field: 'due', daysFromToday: null } },
				// Finished tasks with a past due date are not overdue (the stats line agrees).
				{ key: 'past', label: 'Finished, past due', target: null, note: 'Done or cancelled tasks whose due date has passed.' },
			];
	}
}

const isOpen = (task: IndexedTask) => !['done', 'cancelled'].includes(statusKind(task.status));

/** The column key a task belongs in. */
export function columnKey(task: IndexedTask, field: BoardField, today: string): string {
	switch (field) {
		case 'status':
			return statusKind(task.status);
		case 'priority':
			return task.priority;
		case 'due':
			if (!task.due) return 'none';
			if (task.due < today) return isOpen(task) ? 'overdue' : 'past';
			if (task.due === today) return 'today';
			if (task.due === addDays(today, 1)) return 'tomorrow';
			return task.due <= addDays(today, 7) ? 'week' : 'later';
	}
}

/**
 * Split already filtered and sorted rows into columns, keeping their order. Empty columns that
 * accept drops stay; empty ones that do not are left out.
 */
export function boardColumns<R extends QueryRow>(rows: R[], field: BoardField, today: string): BoardColumn<R>[] {
	const columns = buckets(field).map((b): BoardColumn<R> => ({ ...b, rows: [] }));
	const byKey = new Map(columns.map((c) => [c.key, c]));
	for (const r of rows) {
		const column = byKey.get(columnKey(r.task, field, today));
		if (!column) throw new Error(`no board column for ${field} of ${r.task.path}:${r.task.line}`);
		column.rows.push(r);
	}
	return columns.filter((c) => c.target !== null || c.rows.length > 0);
}

/** What moving `task` into `column` changes, or null if it is already there or the column takes no drops. */
export function moveFor(task: IndexedTask, column: Pick<BoardColumn, 'key' | 'target'>, today: string): BoardMove | null {
	const t = column.target;
	if (!t) return null;
	switch (t.field) {
		case 'status': {
			const from = statusKind(task.status);
			// A custom status of the same kind already belongs here.
			if (from === t.statusKind) return null;
			if (task.recurrence && t.statusKind === 'done') {
				// Only completing an open recurring task creates the next occurrence (through Tasks).
				if (from === 'cancelled') return { kind: 'blocked', reason: 'This recurring task is cancelled. Reopen it first, then complete it, so the next occurrence is created.' };
				return { kind: 'toggle' };
			}
			return { kind: 'edit', edit: { kind: 'status', value: t.char } };
		}
		case 'priority':
			return task.priority === t.value ? null : { kind: 'edit', edit: { kind: 'priority', value: t.value } };
		case 'due': {
			const value = t.daysFromToday === null ? null : addDays(today, t.daysFromToday);
			if ((task.due ?? null) === value) return null;
			return { kind: 'edit', edit: { kind: 'date', field: 'due', value } };
		}
	}
}
