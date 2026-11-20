// Pure task-line parser. No Obsidian imports, so it runs under `node --test`.
// Fixtures: tests/fixtures/task-lines.json. Add a fixture for every bug found.

export type Priority = 'highest' | 'high' | 'medium' | 'none' | 'low' | 'lowest';
export type TaskFormat = 'tasks-emoji' | 'dataview' | 'mixed' | 'plain';

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
	/** Tasks plugin 🆔 */
	id?: string;
	/** Tasks plugin ⛔ */
	dependsOn?: string[];
	/** Tasks plugin 🏁 */
	onCompletion?: string;
	/** Trailing ^block-id */
	blockId?: string;
	tags: string[];
	/** Wikilink targets in the task text (without alias or heading). */
	links: string[];
	/** Dataview inline fields, e.g. [due:: 2026-01-01] or (owner:: Bob). Keys lower-cased. */
	fields: Record<string, string>;
	/** Which syntax the line's metadata uses; write-back must keep it. */
	format: TaskFormat;
}

type DateKey = 'due' | 'scheduled' | 'start' | 'created' | 'done' | 'cancelled';

const TASK_LINE = /^(\s*(?:>\s*)*)([-*+]|\d+[.)])\s+\[(.)\](?:\s(.*))?$/u;

const VS = '\\uFE0F?';
const DATE = '(\\d{4}-\\d{2}-\\d{2})';
const EMOJI_DATES: Array<[DateKey, string]> = [
	['due', `(?:📅|📆|🗓)${VS}`],
	['scheduled', `(?:⏳|⌛)${VS}`],
	['start', `🛫${VS}`],
	['created', `➕${VS}`],
	['done', `✅${VS}`],
	['cancelled', `❌${VS}`],
];
const PRIORITIES: Array<[Priority, string]> = [
	['highest', '🔺'],
	['high', '⏫'],
	['medium', '🔼'],
	['low', '🔽'],
	['lowest', '⏬'],
];
// Every Tasks emoji; a free-text value (recurrence, on-completion) runs until the next one.
const TASKS_EMOJI = '📅📆🗓⏳⌛🛫➕✅❌🔺⏫🔼🔽⏬🔁🆔⛔🏁';
const FREE_TEXT = `([^${TASKS_EMOJI}^]+?)(?=\\s*(?:[${TASKS_EMOJI}]|\\^[\\w-]+\\s*$|$))`;
const RECURRENCE = new RegExp(`🔁${VS}\\s*${FREE_TEXT}`, 'u');
const ON_COMPLETION = new RegExp(`🏁${VS}\\s*([a-z]+)`, 'u');
const TASK_ID = new RegExp(`🆔${VS}\\s*([\\w-]+)`, 'u');
const DEPENDS_ON = new RegExp(`⛔${VS}\\s*([\\w-]+(?:\\s*,\\s*[\\w-]+)*)`, 'u');
const BLOCK_ID = /\s\^([\w-]+)\s*$/u;

// A field value may contain wikilinks, which themselves contain brackets.
const FIELD_VALUE = '((?:\\[\\[[^\\]]*\\]\\]|[^\\[\\]()])*)';
const INLINE_FIELD = new RegExp(
	`\\[([\\p{L}\\p{N}_ -]+?)::\\s*${FIELD_VALUE}\\]|\\(([\\p{L}\\p{N}_ -]+?)::\\s*${FIELD_VALUE}\\)`,
	'gu',
);
const WIKILINK = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/gu;
// A tag starts after whitespace or line start and has at least one non-digit character.
// No lookbehind: it is unsupported on iOS before 16.4.
const TAG = /(^|\s)(#(?![\d/]+(?:\s|$))[\p{L}\p{N}_/-]+)/gu;
const CODE_SPAN = /`[^`]*`/g;
// Private-use character: marks where a code span was hidden during parsing.
const CODE_MARK = '\uE000';
const CODE_PLACEHOLDER = /\uE000(\d+)\uE000/g;

const DATAVIEW_DATE_KEYS: Record<string, DateKey> = {
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
		links: [],
		fields: {},
		format: 'plain',
	};

	// Hide inline code so nothing inside it is read as metadata; restore it at the end.
	const codeSpans: string[] = [];
	let rest = body.replace(CODE_SPAN, (span) => {
		codeSpans.push(span);
		return `${CODE_MARK}${codeSpans.length - 1}${CODE_MARK}`;
	});
	let sawEmoji = false;
	let sawDataview = false;
	const take = (re: RegExp): string | undefined => {
		const hit = re.exec(rest);
		if (!hit) return undefined;
		rest = rest.slice(0, hit.index) + ' ' + rest.slice(hit.index + hit[0].length);
		return hit[1] ?? '';
	};

	const blockId = take(BLOCK_ID);
	if (blockId) task.blockId = blockId;

	for (const [key, emoji] of EMOJI_DATES) {
		const value = take(new RegExp(`${emoji}\\s*${DATE}`, 'u'));
		if (value !== undefined) {
			task[key] = value;
			sawEmoji = true;
		}
	}
	for (const [prio, emoji] of PRIORITIES) {
		const idx = rest.indexOf(emoji);
		if (idx >= 0) {
			task.priority = prio;
			rest = rest.slice(0, idx) + ' ' + rest.slice(idx + emoji.length).replace(/^️/, '');
			sawEmoji = true;
			break;
		}
	}
	const recurrence = take(RECURRENCE);
	if (recurrence !== undefined) {
		task.recurrence = recurrence.trim();
		sawEmoji = true;
	}
	const id = take(TASK_ID);
	if (id !== undefined) {
		task.id = id;
		sawEmoji = true;
	}
	const deps = take(DEPENDS_ON);
	if (deps !== undefined) {
		task.dependsOn = deps.split(',').map((d) => d.trim()).filter(Boolean);
		sawEmoji = true;
	}
	const onCompletion = take(ON_COMPLETION);
	if (onCompletion !== undefined) {
		task.onCompletion = onCompletion;
		sawEmoji = true;
	}

	rest = rest.replace(INLINE_FIELD, (_all, k1?: string, v1?: string, k2?: string, v2?: string) => {
		const key = (k1 ?? k2 ?? '').trim().toLowerCase();
		const value = (v1 ?? v2 ?? '').trim();
		task.fields[key] = value;
		sawDataview = true;
		const mapped = DATAVIEW_DATE_KEYS[key];
		if (mapped && /^\d{4}-\d{2}-\d{2}/.test(value)) task[mapped] = value.slice(0, 10);
		if (key === 'priority' && task.priority === 'none') {
			const p = value.toLowerCase();
			if (PRIORITIES.some(([name]) => name === p)) task.priority = p as Priority;
		}
		if (key === 'repeat' && !task.recurrence) task.recurrence = value;
		return ' ';
	});

	for (const lm of rest.matchAll(WIKILINK)) if (lm[1]) task.links.push(lm[1].trim());
	// Tags are read from the text with wikilinks removed so [[Note#Heading]] is not a tag.
	for (const tm of rest.replace(WIKILINK, ' ').matchAll(TAG)) if (tm[2]) task.tags.push(tm[2]);

	task.text = rest
		.replace(CODE_PLACEHOLDER, (_s, i: string) => codeSpans[Number(i)] ?? '')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
	task.format = sawEmoji && sawDataview ? 'mixed' : sawEmoji ? 'tasks-emoji' : sawDataview ? 'dataview' : 'plain';
	return task;
}

export type StatusKind = 'todo' | 'done' | 'cancelled' | 'in-progress' | 'other';

export function statusKind(status: string): StatusKind {
	if (status === ' ') return 'todo';
	if (status === 'x' || status === 'X') return 'done';
	if (status === '-') return 'cancelled';
	if (status === '/') return 'in-progress';
	return 'other';
}
