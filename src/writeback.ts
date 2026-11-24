// Pure write-back logic: compute the new file content for a task toggle, touching only
// the target line. No Obsidian imports, so the fixture suite can check every byte.

import { applyEdit, type EditOptions, type TaskEdit } from './edit.ts';
import { parseTaskLine, statusKind, type ParsedTask } from './parser.ts';

/** What the view knew about the task when it was indexed. */
export interface TaskRef {
	line: number;
	raw: string;
}

export type CompletionDate = EditOptions['completionDate'];

export interface ToggleOptions extends EditOptions {
	/**
	 * Optional external toggler (the Tasks plugin). Returns the replacement text, which may
	 * be two lines for a recurring task, or the input unchanged if it did not handle it.
	 */
	external?: (line: string) => string;
	/**
	 * The Tasks plugin's global filter, if it has one. Tasks treats a line without it as a
	 * plain checkbox, so it would complete a recurring task there without the next occurrence.
	 */
	tasksGlobalFilter?: string;
	/**
	 * Refuse unless the toggle leaves the task done. The Tasks plugin moves a task to the next
	 * status in its own cycle, which may not be done; a board drop onto Done must not land elsewhere.
	 */
	expectDone?: boolean;
}

export type ToggleResult =
	| { ok: true; content: string; newLines: string[]; via: 'tasks-plugin' | 'built-in' }
	| {
			ok: false;
			reason: 'line-missing' | 'line-changed' | 'not-a-task' | 'recurring-needs-tasks' | 'recurring-outside-global-filter' | 'bad-external-output' | 'tasks-format-mismatch' | 'tasks-localized-dates' | 'invalid-edit' | 'not-completed';
			detail: string;
	  };

/** Split keeping each line's own ending, so CRLF, LF and a missing final newline survive. */
export function splitLines(content: string): Array<{ text: string; eol: string }> {
	const out: Array<{ text: string; eol: string }> = [];
	const re = /(\r\n|\n|\r)/g;
	let start = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(content))) {
		out.push({ text: content.slice(start, m.index), eol: m[0] });
		start = m.index + m[0].length;
	}
	out.push({ text: content.slice(start), eol: '' });
	return out;
}

/** True if any output line uses a metadata style (emoji or Dataview) the input line did not. */
function introducesOtherStyle(input: ParsedTask['format'], outputs: ParsedTask[]): boolean {
	if (input === 'plain' || input === 'mixed') return false;
	const other = input === 'dataview' ? ['tasks-emoji', 'mixed'] : ['dataview', 'mixed'];
	return outputs.some((o) => other.includes(o.format));
}

/**
 * True if `line` has a date in non-ASCII digits. With Obsidian set to a language such as Arabic,
 * the Tasks plugin can write ٢٠٢٦-١١-٢٩, which neither plugin reads back as a date.
 */
export function hasLocalizedDate(line: string): boolean {
	return (line.match(/\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}/gu) ?? []).some((d) => /[^\d-]/.test(d));
}

/** Built-in toggle of one task line: open → done (with completion date), done/cancelled → open. */
export function toggleTaskLine(raw: string, task: ParsedTask, opts: EditOptions): string {
	const kind = statusKind(task.status);
	const completing = kind !== 'done' && kind !== 'cancelled';
	return applyEdit(raw, task, { kind: 'status', value: completing ? 'x' : ' ' }, opts);
}

export type EditResult =
	| { ok: true; content: string; changed: boolean; newLine: string }
	| { ok: false; reason: 'line-missing' | 'line-changed' | 'not-a-task' | 'invalid-edit'; detail: string };

/** Find and verify the indexed line. Shared by toggles and edits. */
function locate(content: string, ref: TaskRef) {
	const lines = splitLines(content);
	const target = lines[ref.line];
	if (!target) return { ok: false as const, reason: 'line-missing' as const, detail: `line ${ref.line + 1} no longer exists` };
	if (target.text !== ref.raw) return { ok: false as const, reason: 'line-changed' as const, detail: `line ${ref.line + 1} changed since it was indexed` };
	const task = parseTaskLine(target.text);
	if (!task) return { ok: false as const, reason: 'not-a-task' as const, detail: `line ${ref.line + 1} is not a task` };
	return { ok: true as const, lines, target, task };
}

/**
 * Apply a field edit (status, date, priority) to the task at `ref.line`. Same safety rules
 * as toggling: the line must be exactly as indexed, and only that line changes.
 */
export function editInContent(content: string, ref: TaskRef, edit: TaskEdit, opts: EditOptions): EditResult {
	const found = locate(content, ref);
	if (!found.ok) return found;
	const { lines, target, task } = found;
	let newLine: string;
	try {
		newLine = applyEdit(target.text, task, edit, opts);
	} catch (err) {
		return { ok: false, reason: 'invalid-edit', detail: err instanceof Error ? err.message : String(err) };
	}
	const after = parseTaskLine(newLine);
	if (!after || after.indent !== task.indent || after.marker !== task.marker) {
		return { ok: false, reason: 'invalid-edit', detail: 'the edit would break the task line' };
	}
	if (newLine === target.text) return { ok: true, content, changed: false, newLine };
	const next = lines.map((l, i) => (i === ref.line ? newLine : l.text) + l.eol).join('');
	return { ok: true, content: next, changed: true, newLine };
}

/**
 * Replace the task at `ref.line` with `text`, a line this plugin wrote or read before (undo).
 * The current line must be exactly `ref.raw`, and the replacement must be a task at the same
 * indent with the same list marker, so undo can never turn into a general line rewrite.
 */
export function replaceLineInContent(content: string, ref: TaskRef, text: string): EditResult {
	const found = locate(content, ref);
	if (!found.ok) return found;
	const { lines, task } = found;
	const after = parseTaskLine(text);
	if (/[\r\n]/.test(text) || !after || after.indent !== task.indent || after.marker !== task.marker) {
		return { ok: false, reason: 'invalid-edit', detail: 'the replacement is not the same task line' };
	}
	if (text === ref.raw) return { ok: true, content, changed: false, newLine: text };
	return { ok: true, content: lines.map((l, i) => (i === ref.line ? text : l.text) + l.eol).join(''), changed: true, newLine: text };
}

/**
 * Toggle the task at `ref.line` in `content`. Refuses rather than guesses: the line must
 * still be exactly what was indexed. Every other byte of the file is left unchanged.
 */
export function toggleInContent(content: string, ref: TaskRef, opts: ToggleOptions): ToggleResult {
	const found = locate(content, ref);
	if (!found.ok) return found;
	const { lines, target, task } = found;

	let newLines: string[] | null = null;
	let via: 'tasks-plugin' | 'built-in' = 'built-in';
	let formatMismatch = false;
	let localizedDates = false;
	const completing = !['done', 'cancelled'].includes(statusKind(task.status));
	if (completing && task.recurrence && opts.external && opts.tasksGlobalFilter && !target.text.includes(opts.tasksGlobalFilter)) {
		return {
			ok: false,
			reason: 'recurring-outside-global-filter',
			detail: `the line does not contain the Tasks global filter (${opts.tasksGlobalFilter}), so Tasks would not create the next occurrence`,
		};
	}
	if (opts.external) {
		const result = opts.external(target.text);
		if (result !== target.text) {
			const out = result.split(/\r\n|\n|\r/);
			// Accept only 1 or 2 task lines at the same indent; anything else is suspicious.
			const parsed = out.map((l) => parseTaskLine(l));
			const valid = out.length >= 1 && out.length <= 2 && parsed.every((p) => p !== null && p.indent === task.indent);
			if (!valid) return { ok: false, reason: 'bad-external-output', detail: 'the Tasks plugin returned an unexpected result' };
			// Tasks reads one format at a time (emoji or Dataview). If it is set to the other
			// format it does not see this line's fields and adds its own style: never accept that.
			// Its dates must stay readable: never accept a line it wrote in another script's digits.
			if (out.some(hasLocalizedDate) && !hasLocalizedDate(target.text)) localizedDates = true;
			else if (introducesOtherStyle(task.format, parsed as ParsedTask[])) formatMismatch = true;
			else {
				newLines = out;
				via = 'tasks-plugin';
			}
		}
	}
	if (!newLines) {
		if (completing && task.recurrence && localizedDates) {
			return {
				ok: false,
				reason: 'tasks-localized-dates',
				detail: 'the Tasks plugin would write the dates in your language\'s digits, which cannot be read back as dates',
			};
		}
		if (completing && task.recurrence && formatMismatch) {
			return {
				ok: false,
				reason: 'tasks-format-mismatch',
				detail: 'the Tasks plugin is set to a different task format than this line uses, so it cannot create the next occurrence',
			};
		}
		if (completing && task.recurrence) {
			return {
				ok: false,
				reason: 'recurring-needs-tasks',
				detail: 'completing a recurring task needs the Tasks plugin (7.2.0 or later) so the next occurrence is created',
			};
		}
		try {
			newLines = [toggleTaskLine(target.text, task, opts)];
		} catch (err) {
			return { ok: false, reason: 'invalid-edit', detail: err instanceof Error ? err.message : String(err) };
		}
	}

	// With a recurring task Tasks returns the next occurrence and the completed line; one must be done.
	if (opts.expectDone && !newLines.some((l) => statusKind(parseTaskLine(l)?.status ?? '') === 'done')) {
		return { ok: false, reason: 'not-completed', detail: 'the toggle would not mark the task done' };
	}
	const eol = target.eol || detectEol(lines);
	const replaced = newLines.map((text, i) => ({ text, eol: i === newLines.length - 1 ? target.eol : eol }));
	const next = [...lines.slice(0, ref.line), ...replaced, ...lines.slice(ref.line + 1)];
	return { ok: true, content: next.map((l) => l.text + l.eol).join(''), newLines, via };
}

function detectEol(lines: Array<{ eol: string }>): string {
	return lines.find((l) => l.eol)?.eol ?? '\n';
}

export interface NewTask {
	text: string;
	due?: string;
	priority?: import('./parser.ts').Priority;
}

export type InsertResult =
	| { ok: true; content: string; line: number; newLine: string }
	| { ok: false; reason: 'line-missing' | 'line-changed' | 'not-a-task' | 'invalid-edit'; detail: string };

/** Build the markdown for a new task, in the given style. */
export function buildTaskLine(task: NewTask, indent: string, opts: EditOptions, style?: 'tasks-emoji' | 'dataview'): string {
	const text = task.text.replace(/[\r\n]+/g, ' ').trim();
	if (!text) throw new Error('the task needs some text');
	let line = `${indent}- [ ] ${text}`;
	const editOpts: EditOptions = { ...opts, newFieldFormat: style ?? opts.newFieldFormat };
	const reparse = () => {
		const p = parseTaskLine(line);
		if (!p) throw new Error('the task text could not be parsed');
		return p;
	};
	if (task.priority && task.priority !== 'none') line = applyEdit(line, reparse(), { kind: 'priority', value: task.priority }, editOpts);
	if (task.due) line = applyEdit(line, reparse(), { kind: 'date', field: 'due', value: task.due }, editOpts);
	// Refuse rather than write a line that would read back differently (for example a 🔁 typed
	// into the text, which would take the due date as its repeat rule).
	const built = reparse();
	if (task.due && built.due !== task.due) throw new Error('the due date would not read back from this task text');
	if (task.priority && built.priority !== task.priority) throw new Error('the priority would not read back from this task text');
	return line;
}

/**
 * Insert a new task line after `after` (verified like any edit), or at the end of the file
 * when `after` is null. Adds exactly one line; every existing byte is kept.
 */
export function insertTaskInContent(content: string, after: TaskRef | null, task: NewTask, opts: EditOptions): InsertResult {
	const lines = splitLines(content);
	let style: 'tasks-emoji' | 'dataview' | undefined;
	let quote = '';
	let index: number;
	if (after) {
		const found = locate(content, after);
		if (!found.ok) return found;
		if (found.task.format === 'dataview') style = 'dataview';
		else if (found.task.format !== 'plain') style = 'tasks-emoji';
		// Keep a blockquote/callout prefix so the new task stays inside it.
		quote = /^(?:\s*>)+\s?/.exec(found.task.indent)?.[0] ?? '';
		// Skip lines that belong to the anchor's list item (nested bullets, continuation
		// text), so they do not become children of the new task.
		index = after.line + 1;
		const nestedIn = (text: string) => text.trim() !== '' && text.startsWith(quote) && /^\s/.test(text.slice(quote.length)) && text.slice(quote.length).trim() !== '';
		while (lines[index] && nestedIn(lines[index]?.text ?? '')) index++;
	} else {
		index = lines.length;
	}
	let newLine: string;
	try {
		newLine = buildTaskLine(task, quote, opts, style);
	} catch (err) {
		return { ok: false, reason: 'invalid-edit', detail: err instanceof Error ? err.message : String(err) };
	}
	const eol = detectEol(lines);
	if (index >= lines.length) {
		// Append at the end. Existing bytes are kept; only a line ending and, after prose,
		// one blank line are added before the new task.
		if (content === '') return { ok: true, content: newLine, line: 0, newLine };
		const endsWithEol = /(?:\r\n|\n|\r)$/.test(content);
		const base = endsWithEol ? content : content + eol;
		const lastText = [...lines].reverse().find((l) => l.text.trim() !== '')?.text;
		const endsWithBlank = /(?:\r\n|\n|\r)[ \t]*(?:\r\n|\n|\r)$/.test(base);
		const gap = !after && lastText !== undefined && !parseTaskLine(lastText) && !endsWithBlank ? eol : '';
		const before = base + gap;
		return { ok: true, content: before + newLine + (endsWithEol ? eol : ''), line: splitLines(before).length - 1, newLine };
	}
	const out = lines.map((l) => ({ ...l }));
	const prev = out[index - 1];
	if (prev && !prev.eol) prev.eol = eol;
	out.splice(index, 0, { text: newLine, eol });
	return { ok: true, content: out.map((l) => l.text + l.eol).join(''), line: index, newLine };
}
