// Pure write-back logic: compute the new file content for a task toggle, touching only
// the target line. No Obsidian imports, so the fixture suite can check every byte.

import { parseTaskLine, statusKind, type ParsedTask } from './parser.ts';

/** What the view knew about the task when it was indexed. */
export interface TaskRef {
	line: number;
	raw: string;
}

export type CompletionDate = 'auto' | 'off';

export interface ToggleOptions {
	/** YYYY-MM-DD used for the completion date. */
	today: string;
	completionDate: CompletionDate;
	/** Whether a plain task (no metadata) gets a Tasks-style ✅ date. True when Tasks is installed. */
	plainGetsEmojiDate: boolean;
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

const DONE_EMOJI = /\s*✅️?\s*\d{4}-\d{2}-\d{2}/u;
const DONE_FIELD = /\s*[[(]completion::\s*[^\])]*[\])]/iu;
const BLOCK_ID_TAIL = /(\s+\^[\w-]+\s*)$/u;

/** Built-in toggle of one task line. Changes the status character and the completion date only. */
export function toggleTaskLine(raw: string, task: ParsedTask, opts: ToggleOptions): string {
	const kind = statusKind(task.status);
	const completing = kind !== 'done' && kind !== 'cancelled';
	const prefixLen = raw.indexOf('[') + 1; // index of the status character
	let line = raw.slice(0, prefixLen) + (completing ? 'x' : ' ') + raw.slice(prefixLen + 1);

	if (!completing) {
		// Un-ticking: remove the completion date in whichever format the parser found it.
		if (task.done === undefined) return line;
		if ('completion' in task.fields) return line.replace(DONE_FIELD, '');
		return line.replace(DONE_EMOJI, '');
	}
	if (opts.completionDate === 'off' || task.done) return line;

	let marker: string | null = null;
	if (task.format === 'dataview') marker = `[completion:: ${opts.today}]`;
	else if (task.format === 'tasks-emoji' || task.format === 'mixed') marker = `✅ ${opts.today}`;
	else if (opts.plainGetsEmojiDate) marker = `✅ ${opts.today}`;
	if (!marker) return line;

	// Insert before a trailing ^block-id so block links keep working; drop trailing spaces first.
	const tail = BLOCK_ID_TAIL.exec(line);
	if (tail) {
		const body = line.slice(0, tail.index).replace(/\s+$/, '');
		return `${body} ${marker}${tail[1] ?? ''}`;
	}
	line = line.replace(/\s+$/, '');
	return `${line} ${marker}`;
}

/**
 * Toggle the task at `ref.line` in `content`. Refuses rather than guesses: the line must
 * still be exactly what was indexed. Every other byte of the file is left unchanged.
 */
export function toggleInContent(content: string, ref: TaskRef, opts: ToggleOptions): ToggleResult {
	const lines = splitLines(content);
	const target = lines[ref.line];
	if (!target) return { ok: false, reason: 'line-missing', detail: `line ${ref.line + 1} no longer exists` };
	if (target.text !== ref.raw) {
		return { ok: false, reason: 'line-changed', detail: `line ${ref.line + 1} changed since it was indexed` };
	}
	const task = parseTaskLine(target.text);
	if (!task) return { ok: false, reason: 'not-a-task', detail: `line ${ref.line + 1} is not a task` };

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
