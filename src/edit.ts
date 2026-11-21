// Pure single-line task edits: status, dates and priority. Each edit keeps the line's
// existing metadata style (Tasks emoji or Dataview fields) and changes nothing else.

import { parseTaskLine, statusKind, type ParsedTask, type Priority } from './parser.ts';

export type FieldFormat = 'tasks-emoji' | 'dataview';
export type DateField = 'due' | 'scheduled' | 'start';

export type TaskEdit =
	| { kind: 'status'; value: string }
	| { kind: 'date'; field: DateField; value: string | null }
	| { kind: 'priority'; value: Priority };

export interface EditOptions {
	/** YYYY-MM-DD used for completion dates. */
	today: string;
	completionDate: 'auto' | 'off';
	/** Whether a plain task gets a Tasks-style ✅ completion date (true when Tasks is installed). */
	plainGetsEmojiDate: boolean;
	/** Style for a field added to a line that has no metadata yet. */
	newFieldFormat: FieldFormat;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DATE_EMOJI: Record<DateField, string> = { due: '📅', scheduled: '⏳', start: '🛫' };
const DATE_EMOJI_RE: Record<DateField, RegExp> = {
	due: /\s*(?:📅|📆|🗓)️?\s*\d{4}-\d{2}-\d{2}/u,
	scheduled: /\s*(?:⏳|⌛)️?\s*\d{4}-\d{2}-\d{2}/u,
	start: /\s*🛫️?\s*\d{4}-\d{2}-\d{2}/u,
};
const PRIORITY_EMOJI: Record<Priority, string> = { highest: '🔺', high: '⏫', medium: '🔼', none: '', low: '🔽', lowest: '⏬' };
const PRIORITY_EMOJI_RE = /\s*(?:🔺|⏫|🔼|🔽|⏬)️?/u;
const DONE_EMOJI_RE = /\s*✅️?\s*\d{4}-\d{2}-\d{2}/u;
const BLOCK_ID_TAIL = /\s+\^[\w-]+\s*$/u;

const fieldRe = (key: string): RegExp => new RegExp(`\\s*[[(]${key}::\\s*(?:\\[\\[[^\\]]*\\]\\]|[^\\[\\]()])*[\\])]`, 'iu');

/** The line with inline code blanked out (same length), so searches never match inside code. */
function masked(line: string): string {
	return line.replace(/`[^`]*`/g, (m) => ''.repeat(m.length));
}

/** First match of `re` outside inline code and outside the `- [ ]` prefix. */
function find(line: string, re: RegExp): { index: number; text: string } | null {
	const m = masked(line);
	const bodyStart = m.indexOf(']') + 1;
	const hit = re.exec(m.slice(bodyStart));
	if (!hit) return null;
	const index = bodyStart + hit.index;
	return { index, text: line.slice(index, index + hit[0].length) };
}

/** Remove every match of `re` (outside inline code) that starts at or after `from`. */
function removeAllFrom(line: string, re: RegExp, from: number): string {
	let head = line.slice(0, from);
	let rest = line.slice(from);
	// find() looks after the first ']', so give the tail a stand-in prefix.
	for (let hit = find(' ]' + rest, re); hit; hit = find(' ]' + rest, re)) rest = replaceAt(' ]' + rest, hit, '').slice(2);
	return head + rest;
}

function replaceAt(line: string, hit: { index: number; text: string }, replacement: string): string {
	return line.slice(0, hit.index) + replacement + line.slice(hit.index + hit.text.length);
}

/** Append a metadata token at the end of the line, before a trailing ^block-id. */
export function insertToken(line: string, token: string): string {
	const tail = BLOCK_ID_TAIL.exec(masked(line));
	if (tail) {
		const body = line.slice(0, tail.index).replace(/\s+$/, '');
		return `${body} ${token}${line.slice(tail.index)}`;
	}
	return `${line.replace(/\s+$/, '')} ${token}`;
}

function styleFor(task: ParsedTask, opts: EditOptions): FieldFormat {
	if (task.format === 'dataview') return 'dataview';
	if (task.format === 'tasks-emoji' || task.format === 'mixed') return 'tasks-emoji';
	return opts.newFieldFormat;
}

function setDate(line: string, task: ParsedTask, field: DateField, value: string | null, opts: EditOptions): string {
	if (value !== null && !ISO.test(value)) throw new Error(`invalid date: ${value}`);
	// Edit the field where it already is, in whichever style it uses.
	// A line can carry the same date more than once (both styles, or repeated); the edit makes
	// the line read back as the value that was set.
	const dv = find(line, fieldRe(field));
	const emoji = find(line, DATE_EMOJI_RE[field]);
	const first = dv && emoji ? (dv.index < emoji.index ? dv : emoji) : (dv ?? emoji);
	if (first) {
		const isDv = first === dv;
		const kept = value === null ? '' : isDv ? first.text.replace(/::\s*[^\])]*/u, `:: ${value}`) : first.text.replace(/\d{4}-\d{2}-\d{2}/, value);
		const out = replaceAt(line, first, kept);
		const from = first.index + kept.length;
		// Clearing removes every copy (a later one would otherwise become the date). Setting
		// removes copies in the other style, which compete with it; a repeated copy in the same
		// style reads as plain text and is left alone.
		if (value === null) return removeAllFrom(removeAllFrom(out, fieldRe(field), from), DATE_EMOJI_RE[field], from);
		return removeAllFrom(out, isDv ? DATE_EMOJI_RE[field] : fieldRe(field), from);
	}
	if (value === null) return line;
	return insertToken(line, styleFor(task, opts) === 'dataview' ? `[${field}:: ${value}]` : `${DATE_EMOJI[field]} ${value}`);
}

function setPriority(line: string, task: ParsedTask, value: Priority, opts: EditOptions): string {
	const dv = find(line, fieldRe('priority'));
	if (dv) return value === 'none' ? replaceAt(line, dv, '') : replaceAt(line, dv, dv.text.replace(/::\s*[^\])]*/u, `:: ${value}`));
	const emoji = find(line, PRIORITY_EMOJI_RE);
	if (emoji) return value === 'none' ? replaceAt(line, emoji, '') : replaceAt(line, emoji, emoji.text.replace(/(?:🔺|⏫|🔼|🔽|⏬)️?/u, PRIORITY_EMOJI[value]));
	if (value === 'none') return line;
	return insertToken(line, styleFor(task, opts) === 'dataview' ? `[priority:: ${value}]` : PRIORITY_EMOJI[value]);
}

function setStatus(line: string, task: ParsedTask, value: string, opts: EditOptions): string {
	if ([...value].length !== 1 || value === '\n' || value === ']') throw new Error(`invalid status: ${JSON.stringify(value)}`);
	const pos = line.indexOf('[') + 1;
	let out = line.slice(0, pos) + value + line.slice(pos + 1);
	const was = statusKind(task.status);
	const now = statusKind(value);
	if (now === 'done' && was !== 'done') return addCompletion(out, task, opts);
	if (now !== 'done' && was === 'done' && task.done !== undefined) {
		const dv = find(out, fieldRe('completion'));
		const hit = dv ?? find(out, DONE_EMOJI_RE);
		if (hit) out = replaceAt(out, hit, '');
	}
	return out;
}

function addCompletion(line: string, task: ParsedTask, opts: EditOptions): string {
	if (opts.completionDate === 'off' || task.done !== undefined) return line;
	if (task.format === 'dataview') return insertToken(line, `[completion:: ${opts.today}]`);
	if (task.format === 'tasks-emoji' || task.format === 'mixed' || opts.plainGetsEmojiDate) return insertToken(line, `✅ ${opts.today}`);
	return line;
}

/** Apply one edit to a task line. Throws on invalid input; never touches text outside metadata. */
export function applyEdit(line: string, task: ParsedTask, edit: TaskEdit, opts: EditOptions): string {
	const out = editLine(line, task, edit, opts);
	// Refuse rather than guess: the edit must read back as asked, and leave the description and
	// repeat rule as they were. On unusual lines (duplicate fields, a free-text 🔁 rule that ends
	// at the field being changed) a change could otherwise shift how the rest of the line reads.
	const after = parseTaskLine(out);
	if (!after) throw new Error('the edit would break the task line');
	const same = (a?: string) => (a ?? '').replace(/\s+/g, ' ').trim();
	if (same(after.text) !== same(task.text) || same(after.recurrence) !== same(task.recurrence)) {
		throw new Error('the edit would change how the rest of the line reads');
	}
	if (edit.kind === 'date' && after[edit.field] !== (edit.value ?? undefined)) throw new Error(`the ${edit.field} date would not read back as set`);
	if (edit.kind === 'priority' && after.priority !== edit.value) throw new Error('the priority would not read back as set');
	if (edit.kind === 'status' && after.status !== edit.value) throw new Error('the status would not read back as set');
	return out;
}

function editLine(line: string, task: ParsedTask, edit: TaskEdit, opts: EditOptions): string {
	switch (edit.kind) {
		case 'status':
			return setStatus(line, task, edit.value, opts);
		case 'date':
			return setDate(line, task, edit.field, edit.value, opts);
		case 'priority':
			return setPriority(line, task, edit.value, opts);
	}
}
