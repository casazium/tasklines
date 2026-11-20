// Pure task-line parser. No Obsidian imports, so it runs under `node --test`.

export type Priority = 'highest' | 'high' | 'medium' | 'none' | 'low' | 'lowest';

export interface ParsedTask {
	/** Raw line exactly as read from the file; write-back verifies against this. */
	raw: string;
	indent: string;
	marker: string;
	/** Single status character between the brackets, e.g. ' ', 'x', '/', '-'. */
	status: string;
	/** Task description with recognised metadata removed. */
	text: string;
	due?: string;
	scheduled?: string;
	start?: string;
	created?: string;
	done?: string;
	cancelled?: string;
	priority: Priority;
	recurrence?: string;
	tags: string[];
	/** Dataview inline fields, e.g. [due:: 2026-01-01] or (owner:: Bob). Keys lower-cased. */
	fields: Record<string, string>;
	/** Which syntax the line's metadata uses; write-back must keep it. */
	format: 'tasks-emoji' | 'dataview' | 'mixed' | 'plain';
}

const TASK_LINE = /^(\s*(?:>\s*)*)([-*+]|\d+[.)])\s+\[(.)\]\s?(.*)$/u;

const DATE = '(\\d{4}-\\d{2}-\\d{2})';
const EMOJI_DATES: Array<[keyof ParsedTask, string]> = [
	['due', '(?:📅|📆|🗓)️?'],
	['scheduled', '(?:⏳|⌛)️?'],
	['start', '🛫️?'],
	['created', '➕️?'],
	['done', '✅️?'],
	['cancelled', '❌️?'],
];
const PRIORITIES: Array<[Priority, string]> = [
	['highest', '🔺'],
	['high', '⏫'],
	['medium', '🔼'],
	['low', '🔽'],
	['lowest', '⏬'],
];
// Recurrence runs until the next Tasks emoji or end of line.
const RECURRENCE = /🔁️?\s*([^📅📆🗓⏳⌛🛫➕✅❌🔺⏫🔼🔽⏬🆔⛔🏁]+)/u;
const INLINE_FIELD = /[[(]([\p{L}\p{N}_ -]+?)::\s*([^\])]*)[\])]/gu;
const TAG = /(?:^|\s)(#[\p{L}\p{N}_/-]+)/gu;

const DATAVIEW_DATE_KEYS: Record<string, keyof ParsedTask> = {
	due: 'due',
	scheduled: 'scheduled',
	start: 'start',
	created: 'created',
	completion: 'done',
	cancelled: 'cancelled',
};

export function isTaskLine(line: string): boolean {
	return TASK_LINE.test(line);
}

export function parseTaskLine(line: string): ParsedTask | null {
	const m = TASK_LINE.exec(line);
	if (!m) return null;
	const [, indent = '', marker = '-', status = ' ', body = ''] = m;

	const task: ParsedTask = {
		raw: line,
		indent,
		marker,
		status,
		text: body,
		priority: 'none',
		tags: [],
		fields: {},
		format: 'plain',
	};
	let rest = body;
	let sawEmoji = false;
	let sawDataview = false;

	for (const [key, emoji] of EMOJI_DATES) {
		const re = new RegExp(`${emoji}\\s*${DATE}`, 'u');
		const dm = re.exec(rest);
		if (dm) {
			(task as unknown as Record<string, string>)[key] = dm[1] ?? '';
			rest = rest.replace(dm[0], '');
			sawEmoji = true;
		}
	}
	for (const [prio, emoji] of PRIORITIES) {
		if (rest.includes(emoji)) {
			task.priority = prio;
			rest = rest.replace(emoji, '');
			sawEmoji = true;
			break;
		}
	}
	const rm = RECURRENCE.exec(rest);
	if (rm) {
		task.recurrence = (rm[1] ?? '').trim();
		rest = rest.replace(rm[0], '');
		sawEmoji = true;
	}

	for (const fm of rest.matchAll(INLINE_FIELD)) {
		const key = (fm[1] ?? '').trim().toLowerCase();
		const value = (fm[2] ?? '').trim();
		task.fields[key] = value;
		sawDataview = true;
		const mapped = DATAVIEW_DATE_KEYS[key];
		if (mapped && /^\d{4}-\d{2}-\d{2}/.test(value)) {
			(task as unknown as Record<string, string>)[mapped] = value.slice(0, 10);
		}
		if (key === 'priority' && task.priority === 'none') {
			const p = value.toLowerCase();
			if (PRIORITIES.some(([name]) => name === p)) task.priority = p as Priority;
		}
		if (key === 'repeat' && !task.recurrence) task.recurrence = value;
	}
	rest = rest.replace(INLINE_FIELD, '');

	for (const tm of body.matchAll(TAG)) {
		if (tm[1]) task.tags.push(tm[1]);
	}

	task.text = rest.replace(/\s{2,}/g, ' ').trim();
	task.format = sawEmoji && sawDataview ? 'mixed' : sawEmoji ? 'tasks-emoji' : sawDataview ? 'dataview' : 'plain';
	return task;
}

/** Completed in the Tasks/Obsidian sense: any status other than space, excluding cancelled. */
export function statusKind(status: string): 'todo' | 'done' | 'cancelled' | 'in-progress' | 'other' {
	if (status === ' ') return 'todo';
	if (status === 'x' || status === 'X') return 'done';
	if (status === '-') return 'cancelled';
	if (status === '/') return 'in-progress';
	return 'other';
}
