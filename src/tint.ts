// Row, card and chip colouring ("Color" in the views' options). Pure: no DOM, no Obsidian runtime.
// A colour is never the only cue: each tint carries words for screen readers, and the
// same facts can be shown as columns, icons or dates.

import { isRealDate } from './calendar.ts';
import { statusKind, type Priority } from './parser.ts';
import type { QueryRow } from './query.ts';

export const COLOR_BY = ['none', 'due', 'priority', 'property'] as const;
export type ColorBy = (typeof COLOR_BY)[number];
export const COLOR_BY_LABELS: Record<ColorBy, string> = { none: 'None', due: 'Due date', priority: 'Priority', property: 'Note property' };

/** Obsidian's theme colours (`--color-<tone>-rgb`), so every theme picks its own shades. */
export const TONES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;
export type Tone = (typeof TONES)[number];
/** Property values never get red: in Obsidian red means overdue or an error, and the calendar marks overdue tasks in red. */
const PROPERTY_TONES: readonly Tone[] = TONES.filter((t) => t !== 'red');

export interface Tint {
	/** What the colour stands for; 'today' and 'overdue' come from the due date. */
	kind: 'overdue' | 'today' | 'priority' | 'property';
	tone: Tone;
	/** Read to screen readers after the task, e.g. "overdue" or "area: home". */
	label: string;
}

const PRIORITY_TONES: Partial<Record<Priority, Tone>> = { highest: 'red', high: 'orange', medium: 'yellow', low: 'blue', lowest: 'cyan' };

export function normalizeColorBy(raw: unknown): ColorBy {
	return typeof raw === 'string' && (COLOR_BY as readonly string[]).includes(raw) ? (raw as ColorBy) : 'none';
}

/**
 * The tint for one task, or null for none.
 * Due date and priority colour open tasks only: a finished task is no longer urgent.
 * A note property colours every task in the note, the same colour for the same value.
 */
export function tintFor(row: Pick<QueryRow, 'task' | 'props'>, by: ColorBy, today: string, property?: { id: string; name: string } | null): Tint | null {
	const t = row.task;
	const kind = statusKind(t.status);
	const open = kind !== 'done' && kind !== 'cancelled';
	switch (by) {
		case 'due':
			// A date that doesn't exist (2026-02-30) is neither overdue nor today; the calendar flags it.
			if (!open || !t.due || !isRealDate(t.due)) return null;
			if (t.due < today) return { kind: 'overdue', tone: 'red', label: 'overdue' };
			if (t.due === today) return { kind: 'today', tone: 'orange', label: 'due today' };
			return null;
		case 'priority': {
			const tone = open ? PRIORITY_TONES[t.priority] : undefined;
			return tone ? { kind: 'priority', tone, label: `${t.priority} priority` } : null;
		}
		case 'property': {
			if (!property) return null;
			const value = row.props.get(property.id)?.trim() ?? '';
			return value ? { kind: 'property', tone: toneFor(value), label: `${property.name}: ${value}` } : null;
		}
		default:
			return null;
	}
}

/** A property value's tone: the same value always gets the same one, on every device and after every reload. */
export function toneFor(value: string): Tone {
	// FNV-1a: small, stable and spreads short strings well.
	let h = 0x811c9dc5;
	for (const ch of value.toLowerCase()) {
		h ^= ch.codePointAt(0) ?? 0;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return PROPERTY_TONES[h % PROPERTY_TONES.length] ?? 'blue';
}

/** Where a tint is drawn, and what that place already shows. */
export type TintPlace =
	| { view: 'list'; priorityColumn: boolean }
	| { view: 'board'; field: 'status' | 'priority' | 'due' }
	| { view: 'calendar'; field: 'due' | 'scheduled' | 'start' };

/**
 * Whether the place already says what the tint means, so screen readers don't hear it twice.
 * - List: the Priority column, when shown, says the priority. Nothing in a row says "overdue" or "today".
 * - Board: a card says overdue (its date, or the Overdue column) and its priority (its mark, or its
 *   column); "today" only on the due-date board, as the Today column.
 * - Calendar of due dates: a chip says overdue, and its day says today.
 */
export function tintAlreadySaid(tint: Tint, place: TintPlace): boolean {
	if (tint.kind === 'property') return false;
	switch (place.view) {
		case 'list':
			return tint.kind === 'priority' && place.priorityColumn;
		case 'board':
			return tint.kind === 'overdue' || tint.kind === 'priority' || (tint.kind === 'today' && place.field === 'due');
		case 'calendar':
			return place.field === 'due' && (tint.kind === 'overdue' || tint.kind === 'today');
	}
}
