// Bulk actions: what one action does to each selected task, the order to write them in, and
// the report. Pure: no DOM, no Obsidian runtime. Every step is one existing single-line write
// (an edit, or the checkbox's toggle for completing an open recurring task), reusing the board's
// and calendar's move rules, so a batch adds no new way of changing a note.

import { boardColumns, moveFor } from './board.ts';
import { canClear, isRealDate, type CalendarField } from './calendar.ts';
import type { TaskEdit } from './edit.ts';
import type { IndexedTask } from './extract.ts';
import { statusKind, type Priority } from './parser.ts';
import { addDays } from './query.ts';

export type BulkAction =
	| { kind: 'complete' }
	| { kind: 'reopen' }
	| { kind: 'status'; char: string }
	| { kind: 'priority'; value: Priority }
	/** Set the same date on every task (null removes it). */
	| { kind: 'set-date'; field: CalendarField; value: string | null }
	/** Move each task's own date by `days`, counting from today when the date has passed. */
	| { kind: 'shift-date'; field: CalendarField; days: number };

export type StepOp = { kind: 'edit'; edit: TaskEdit } | { kind: 'toggle' } | { kind: 'skip'; reason: string } | { kind: 'refuse'; reason: string };

export interface PlannedStep {
	task: IndexedTask;
	op: StepOp;
}

const isOpen = (t: IndexedTask) => !['done', 'cancelled'].includes(statusKind(t.status));

/** The status board's column for a kind, which carries the status character to write. */
function statusColumn(kind: 'todo' | 'done', today: string) {
	return boardColumns([], 'status', today).find((c) => c.key === kind) ?? null;
}

/** What `action` does to one task. */
export function planStep(task: IndexedTask, action: BulkAction, today: string): StepOp {
	switch (action.kind) {
		case 'complete': {
			if (!isOpen(task)) return { kind: 'skip', reason: 'already finished' };
			const col = statusColumn('done', today);
			const move = col ? moveFor(task, col, today) : null;
			if (!move) return { kind: 'skip', reason: 'already finished' };
			if (move.kind === 'blocked') return { kind: 'refuse', reason: move.reason };
			return move.kind === 'toggle' ? { kind: 'toggle' } : { kind: 'edit', edit: move.edit };
		}
		case 'reopen': {
			if (isOpen(task)) return { kind: 'skip', reason: 'already open' };
			const col = statusColumn('todo', today);
			const move = col ? moveFor(task, col, today) : null;
			if (!move || move.kind !== 'edit') return { kind: 'skip', reason: 'already open' };
			return { kind: 'edit', edit: move.edit };
		}
		case 'status': {
			if (task.status === action.char) return { kind: 'skip', reason: 'already has that status' };
			const kind = statusKind(action.char);
			// Completing an open task goes through the same rules as the board's Done column
			// (a recurring task is completed through the Tasks plugin; a cancelled one is blocked).
			if (kind === 'done' && isOpen(task)) {
				const col = statusColumn('done', today);
				const move = col ? moveFor(task, { ...col, target: { field: 'status', char: action.char, statusKind: 'done' } }, today) : null;
				if (move?.kind === 'blocked') return { kind: 'refuse', reason: move.reason };
				if (move?.kind === 'toggle') return { kind: 'toggle' };
			}
			if (kind === 'done' && statusKind(task.status) === 'cancelled' && task.recurrence) {
				return { kind: 'refuse', reason: 'This recurring task is cancelled. Reopen it first, then complete it, so the next occurrence is created.' };
			}
			return { kind: 'edit', edit: { kind: 'status', value: action.char } };
		}
		case 'priority':
			return task.priority === action.value ? { kind: 'skip', reason: 'already has that priority' } : { kind: 'edit', edit: { kind: 'priority', value: action.value } };
		case 'set-date': {
			const own = task[action.field] ?? null;
			if (action.value === null) {
				if (!own) return { kind: 'skip', reason: 'has no date to remove' };
				if (!canClear(task, action.field)) return { kind: 'refuse', reason: 'A recurring task keeps its last date, so it has one to repeat from.' };
				return { kind: 'edit', edit: { kind: 'date', field: action.field, value: null } };
			}
			if (!isRealDate(action.value)) return { kind: 'refuse', reason: `${action.value} is not a real date.` };
			if (own === action.value) return { kind: 'skip', reason: 'already on that date' };
			return { kind: 'edit', edit: { kind: 'date', field: action.field, value: action.value } };
		}
		case 'shift-date': {
			const own = task[action.field];
			if (!own || !isRealDate(own)) return { kind: 'skip', reason: 'has no date to move' };
			// Like the calendar's "One day later": from the task's own date, or from today once it has passed.
			const base = own >= today ? own : today;
			const value = addDays(base, action.days);
			if (value === own) return { kind: 'skip', reason: 'already on that date' };
			return { kind: 'edit', edit: { kind: 'date', field: action.field, value } };
		}
	}
}

export function planBulk(tasks: IndexedTask[], action: BulkAction, today: string): PlannedStep[] {
	return tasks.map((task) => ({ task, op: planStep(task, action, today) }));
}

/**
 * The order to write in: note by note, and within a note from the bottom line up. A recurring
 * completion puts two lines where one was (Tasks adds the next occurrence), which shifts only
 * the lines below it; working upwards, every task still to be written keeps its line number.
 */
export function orderForWrite<S extends { task: IndexedTask }>(steps: S[]): S[] {
	const notes = new Map<string, S[]>();
	for (const s of steps) {
		const list = notes.get(s.task.path);
		if (list) list.push(s);
		else notes.set(s.task.path, [s]);
	}
	return [...notes.values()].flatMap((list) => [...list].sort((a, b) => b.task.line - a.task.line));
}

/** A line the batch wrote, to put back on Undo. */
export interface UndoRecord {
	path: string;
	line: number;
	/** The line as the batch wrote it. */
	written: string;
	/** The line before the batch. */
	original: string;
}

/**
 * After a write at `line` of `path` left `count` lines where one was, move the undo records for
 * lines below it. (Records are only ever below, since a batch works upwards in each note.)
 */
export function shiftRecords(records: UndoRecord[], path: string, line: number, count: number): void {
	const delta = count - 1;
	if (!delta) return;
	for (const r of records) if (r.path === path && r.line > line) r.line += delta;
}

export type StepOutcome = 'written' | 'skipped' | 'refused' | 'failed';

export interface BulkSummary {
	written: number;
	skipped: number;
	refused: number;
	failed: number;
	/** How many of the written steps were recurring completions (not undoable). */
	toggled: number;
	/** Distinct reasons, with counts, for what was skipped, refused or failed. */
	reasons: Array<{ outcome: Exclude<StepOutcome, 'written'>; reason: string; count: number }>;
}

export function summarize(outcomes: Array<{ outcome: StepOutcome; reason?: string; toggle?: boolean }>): BulkSummary {
	const s: BulkSummary = { written: 0, skipped: 0, refused: 0, failed: 0, toggled: 0, reasons: [] };
	const reasons = new Map<string, BulkSummary['reasons'][number]>();
	for (const o of outcomes) {
		s[o.outcome]++;
		if (o.outcome === 'written') {
			if (o.toggle) s.toggled++;
			continue;
		}
		const key = `${o.outcome}\n${o.reason ?? ''}`;
		const r = reasons.get(key);
		if (r) r.count++;
		else reasons.set(key, { outcome: o.outcome, reason: o.reason ?? '', count: 1 });
	}
	s.reasons = [...reasons.values()];
	return s;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Completed 8 of 10 tasks. 1 skipped: already finished. 1 refused: …" */
export function describeSummary(verb: string, total: number, s: BulkSummary): string {
	const parts = [`${verb} ${s.written} of ${plural(total, 'task')}.`];
	for (const r of s.reasons) parts.push(`${r.count} ${r.outcome}: ${r.reason}${/[.!?]$/.test(r.reason) ? '' : '.'}`);
	if (s.toggled) parts.push(`${plural(s.toggled, 'recurring task')} completed through the Tasks plugin can't be undone here.`);
	return parts.join(' ');
}

/** Plain words for the confirmation: what will be written, and what can't be undone. */
export function describePlan(verb: string, steps: PlannedStep[]): { writes: number; notes: number; toggles: number; text: string } {
	const writes = steps.filter((s) => s.op.kind === 'edit' || s.op.kind === 'toggle');
	const notes = new Set(writes.map((s) => s.task.path)).size;
	const toggles = writes.filter((s) => s.op.kind === 'toggle').length;
	let text = `${verb} ${plural(writes.length, 'task')} in ${plural(notes, 'note')}?`;
	const skipped = steps.length - writes.length;
	if (skipped) text += ` ${plural(skipped, 'selected task')} will be skipped or refused.`;
	if (toggles) text += ` ${plural(toggles, 'recurring task')} will be completed through the Tasks plugin, which adds the next occurrence; Undo can't take those back.`;
	return { writes: writes.length, notes, toggles, text };
}
