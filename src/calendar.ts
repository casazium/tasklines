// Task calendar: which day a task sits on, the month grid, the agenda, and what moving a task
// to another day changes. Pure: no DOM, no Obsidian runtime. Every move is one existing
// single-line date edit, so the calendar adds no new way of writing. Dates only: no times.

import type { DateField, TaskEdit } from './edit.ts';
import type { IndexedTask } from './extract.ts';
import { statusKind } from './parser.ts';
import { addDays, type QueryRow } from './query.ts';

export const CALENDAR_FIELDS = ['due', 'scheduled', 'start'] as const satisfies readonly DateField[];
export type CalendarField = (typeof CALENDAR_FIELDS)[number];
export const CALENDAR_FIELD_LABELS: Record<CalendarField, string> = { due: 'Due date', scheduled: 'Scheduled date', start: 'Start date' };

export const CALENDAR_LAYOUTS = ['month', 'agenda'] as const;
export type CalendarLayout = (typeof CALENDAR_LAYOUTS)[number];
/** Choices for the view option. Automatic is the default: the agenda on phones, the month elsewhere. */
export const CALENDAR_LAYOUT_CHOICES = ['auto', ...CALENDAR_LAYOUTS] as const;
export const CALENDAR_LAYOUT_LABELS: Record<(typeof CALENDAR_LAYOUT_CHOICES)[number], string> = { auto: 'Automatic (agenda on phones)', month: 'Month', agenda: 'Agenda' };

/** Days the agenda lists one by one, starting today; later dates are grouped under Later. */
export const AGENDA_DAYS = 14;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeCalendarField(raw: unknown): CalendarField {
	return typeof raw === 'string' && (CALENDAR_FIELDS as readonly string[]).includes(raw) ? (raw as CalendarField) : 'due';
}

/** The saved layout, or the device's default for Automatic or anything unrecognised. */
export function normalizeCalendarLayout(raw: unknown, fallback: CalendarLayout): CalendarLayout {
	return typeof raw === 'string' && (CALENDAR_LAYOUTS as readonly string[]).includes(raw) ? (raw as CalendarLayout) : fallback;
}

/** A YYYY-MM-DD that is a real day (the parser also accepts 2026-11-31 or 2026-13-45). */
export function isRealDate(date: string): boolean {
	return ISO.test(date) && addDays(date, 0) === date;
}

const isOpen = (task: IndexedTask) => !['done', 'cancelled'].includes(statusKind(task.status));

/** Day of the week for a YYYY-MM-DD date, 0 = Sunday. */
export function weekday(date: string): number {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** First day of the month containing `date`, as YYYY-MM-01. */
export function monthOf(date: string): string {
	return `${date.slice(0, 7)}-01`;
}

/** The first day of the month `delta` months from `month` (a YYYY-MM-01 date). */
export function shiftMonth(month: string, delta: number): string {
	const [y, m] = month.split('-').map(Number);
	const total = (y ?? 1970) * 12 + ((m ?? 1) - 1) + delta;
	const year = Math.floor(total / 12);
	const mon = total - year * 12 + 1;
	return `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}-01`;
}

/**
 * The weeks shown for a month: full weeks starting on `weekStart` (0 = Sunday … 6 = Saturday),
 * from the week holding the 1st to the week holding the last day. Four to six weeks of 7 dates.
 */
export function monthGrid(month: string, weekStart: number): string[][] {
	const first = monthOf(month);
	const back = (weekday(first) - weekStart + 7) % 7;
	const last = addDays(shiftMonth(first, 1), -1);
	const weeks: string[][] = [];
	for (let day = addDays(first, -back); day <= last; ) {
		const week: string[] = [];
		for (let i = 0; i < 7; i++, day = addDays(day, 1)) week.push(day);
		weeks.push(week);
	}
	return weeks;
}

/**
 * Tasks by the day of their date field, keeping row order. Tasks without that date, or with one
 * that is not a real day, are set apart so they still show (in No date, with the bad date shown).
 */
export function byDay<R extends QueryRow>(rows: R[], field: CalendarField): { days: Map<string, R[]>; undated: R[] } {
	const days = new Map<string, R[]>();
	const undated: R[] = [];
	for (const r of rows) {
		const date = r.task[field];
		if (!date || !isRealDate(date)) {
			undated.push(r);
			continue;
		}
		const list = days.get(date);
		if (list) list.push(r);
		else days.set(date, [r]);
	}
	return { days, undated };
}

export interface AgendaSection<R extends QueryRow = QueryRow> {
	/** 'overdue', a YYYY-MM-DD day, 'later' or 'none'. */
	key: string;
	/** The day a drop here sets, or null for sections that are not a single day. */
	date: string | null;
	rows: R[];
}

/**
 * The agenda: open tasks dated before today (Overdue), then each of the next AGENDA_DAYS days
 * that has tasks, then Later and No date. The first `emptyDays` days (today at least) show even
 * when empty, as places to drop tasks. Finished tasks dated before today are left out: the agenda
 * looks forward.
 */
export function agenda<R extends QueryRow>(rows: R[], field: CalendarField, today: string, emptyDays = 1): AgendaSection<R>[] {
	const end = addDays(today, AGENDA_DAYS - 1);
	const overdue: R[] = [];
	const later: R[] = [];
	const { days, undated } = byDay(rows, field);
	const sections: AgendaSection<R>[] = [];
	for (const [date, list] of [...days].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		if (date < today) overdue.push(...list.filter((r) => isOpen(r.task)));
		else if (date > end) later.push(...list);
	}
	if (overdue.length) sections.push({ key: 'overdue', date: null, rows: overdue });
	for (let day = today; day <= end; day = addDays(day, 1)) {
		const list = days.get(day);
		if (list?.length || day < addDays(today, Math.max(1, emptyDays))) sections.push({ key: day, date: day, rows: list ?? [] });
	}
	if (later.length) sections.push({ key: 'later', date: null, rows: later });
	sections.push({ key: 'none', date: null, rows: undated });
	return sections;
}

/**
 * Whether the date can be removed. A recurring task needs a date to repeat from, so its last
 * remaining due, scheduled or start date stays.
 */
export function canClear(task: IndexedTask, field: CalendarField): boolean {
	if (!task[field]) return false;
	if (!task.recurrence) return true;
	return CALENDAR_FIELDS.some((f) => f !== field && !!task[f]);
}

/** The edit that puts `task` on `date` (null clears the date), or null if there is nothing to do or it is not allowed. */
export function moveToDate(task: IndexedTask, field: CalendarField, date: string | null): TaskEdit | null {
	if (date !== null && !isRealDate(date)) return null;
	if (date === null && !canClear(task, field)) return null;
	if ((task[field] ?? null) === date) return null;
	return { kind: 'date', field, value: date };
}

/** Quick reschedule choices for a task's menu, resolved against today and the task's own date. */
export function quickDates(task: IndexedTask, field: CalendarField, today: string): Array<{ label: string; date: string | null }> {
	const own = task[field];
	const choices: Array<{ label: string; date: string | null }> = [
		{ label: 'Today', date: today },
		{ label: 'Tomorrow', date: addDays(today, 1) },
	];
	// Relative to the task's own date when it has one in the future; otherwise to today.
	const base = own && isRealDate(own) && own >= today ? own : today;
	choices.push({ label: 'One day later', date: addDays(base, 1) }, { label: 'One week later', date: addDays(base, 7) });
	if (canClear(task, field)) choices.push({ label: 'Remove date', date: null });
	// Drop choices that would land on the same day as an earlier one, or change nothing.
	const seen = new Set<string | null>([own ?? null]);
	return choices.filter((c) => (seen.has(c.date) ? false : (seen.add(c.date), true)));
}
