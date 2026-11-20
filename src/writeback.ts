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
}

export type ToggleResult =
	| { ok: true; content: string; newLines: string[]; via: 'tasks-plugin' | 'built-in' }
	| { ok: false; reason: 'line-missing' | 'line-changed' | 'not-a-task' | 'recurring-needs-tasks' | 'bad-external-output'; detail: string };

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
 * Toggle the task at `ref.line` in `content`. Refuses rather than guesses: the line must
 * still be exactly what was indexed. Every other byte of the file is left unchanged.
 */
export function toggleInContent(content: string, ref: TaskRef, opts: ToggleOptions): ToggleResult {
	const found = locate(content, ref);
	if (!found.ok) return found;
	const { lines, target, task } = found;

	let newLines: string[] | null = null;
	let via: 'tasks-plugin' | 'built-in' = 'built-in';
	if (opts.external && task.format !== 'dataview') {
		const result = opts.external(target.text);
		if (result !== target.text) {
			const out = result.split(/\r\n|\n|\r/);
			// Accept only 1 or 2 task lines at the same indent; anything else is suspicious.
			const valid =
				out.length >= 1 &&
				out.length <= 2 &&
				out.every((l) => {
					const p = parseTaskLine(l);
					return p !== null && p.indent === task.indent;
				});
			if (!valid) return { ok: false, reason: 'bad-external-output', detail: 'the Tasks plugin returned an unexpected result' };
			newLines = out;
			via = 'tasks-plugin';
		}
	}
	if (!newLines) {
		const completing = !['done', 'cancelled'].includes(statusKind(task.status));
		if (completing && task.recurrence) {
			return {
				ok: false,
				reason: 'recurring-needs-tasks',
				detail: 'completing a recurring task needs the Tasks plugin (7.2.0 or later) so the next occurrence is created',
			};
		}
		newLines = [toggleTaskLine(target.text, task, opts)];
	}

	const eol = target.eol || detectEol(lines);
	const replaced = newLines.map((text, i) => ({ text, eol: i === newLines.length - 1 ? target.eol : eol }));
	const next = [...lines.slice(0, ref.line), ...replaced, ...lines.slice(ref.line + 1)];
	return { ok: true, content: next.map((l) => l.text + l.eol).join(''), newLines, via };
}

function detectEol(lines: Array<{ eol: string }>): string {
	return lines.find((l) => l.eol)?.eol ?? '\n';
}
