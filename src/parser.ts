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
// It also stops before a Dataview inline field, e.g. `🔁 every week [completion:: …]`, and is
// never a Dataview field itself (a bare `🔁 [completion:: …]` has no rule). Inline code ends it
// too (\uE000 is the placeholder for a code span), as do links and comments (\uE001) and a
// #tag, and it needs some text: a bare 🔁 followed by another emoji has no rule and stays part
// of the description.
const FREE_TEXT = `(?!\\s*[[(][\\p{L}\\p{N}_ -]+::)(?=\\s*[^\\s${TASKS_EMOJI}^\\uE000\\uE001#])([^${TASKS_EMOJI}^\\uE000\\uE001]+?)(?=\\s*(?:[${TASKS_EMOJI}\\uE000\\uE001]|[[(][\\p{L}\\p{N}_ -]+::|\\^[\\w-]+\\s*$|$)|\\s+#[\\p{L}\\p{N}_/-])`;
const RECURRENCE = new RegExp(`🔁${VS}\\s*${FREE_TEXT}`, 'u');
const ON_COMPLETION = new RegExp(`🏁${VS}\\s*([a-z]+)`, 'u');
const TASK_ID = new RegExp(`🆔${VS}\\s*([\\w-]+)`, 'u');
const DEPENDS_ON = new RegExp(`⛔${VS}\\s*([\\w-]+(?:\\s*,\\s*[\\w-]+)*)`, 'u');
const BLOCK_ID = /(?:^|\s)\^([\w-]+)\s*$/u;

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
// Private-use characters: mark where a code span, or a link or comment, was hidden during parsing.
const CODE_MARK = '\uE000';
const CODE_PLACEHOLDER = /\uE000(\d+)\uE000/g;
const LINK_MARK = '\uE001';
const LINK_PLACEHOLDER = /\uE001(\d+)\uE001/g;
// A Tasks emoji in a note name, a link address or a %% comment %% is not task metadata.
const OPAQUE_SPAN = /\[\[[^\]]*\]\]|\]\([^)]*\)|%%.*?%%/gu;

/**
 * Where the inline code is, as CommonMark reads it: a run of backticks closes at the next run of
 * the same length, a run with no partner is literal, and a backslash escapes a backtick outside code.
 */
function codeRanges(text: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const runAt = (from: number) => {
		let end = from;
		while (text[end] === '`') end++;
		return end - from;
	};
	let i = 0;
	while (i < text.length) {
		if (text[i] === '\\') {
			i += 2;
			continue;
		}
		if (text[i] !== '`') {
			i++;
			continue;
		}
		const size = runAt(i);
		let close = -1;
		for (let j = i + size; j < text.length; ) {
			if (text[j] !== '`') {
				j++;
				continue;
			}
			const run = runAt(j);
			if (run === size) {
				close = j;
				break;
			}
			j += run;
		}
		if (close < 0) {
			i += size;
			continue;
		}
		ranges.push([i, close + size]);
		i = close + size;
	}
	return ranges;
}

function replaceCode(text: string, replace: (span: string) => string): string {
	let out = '';
	let at = 0;
	for (const [start, end] of codeRanges(text)) {
		out += text.slice(at, start) + replace(text.slice(start, end));
		at = end;
	}
	return out + text.slice(at);
}

/**
 * The line with inline code blanked out, at the same length, so searches never match inside it.
 * With `links`, also blanks wikilinks, link addresses and comments, for finding Tasks emoji.
 */
export function maskInline(line: string, links = false): string {
	const blank = (span: string) => CODE_MARK.repeat(span.length);
	const code = replaceCode(line, blank);
	return links ? code.replace(OPAQUE_SPAN, blank) : code;
}

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
	let rest = replaceCode(body, (span) => {
		codeSpans.push(span);
		return `${CODE_MARK}${codeSpans.length - 1}${CODE_MARK}`;
	});
	// Hide links and comments while reading emoji; Dataview fields may hold links, so they come back first.
	const linkSpans: string[] = [];
	rest = rest.replace(OPAQUE_SPAN, (span) => {
		linkSpans.push(span);
		return `${LINK_MARK}${linkSpans.length - 1}${LINK_MARK}`;
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

	// Before the dates: a rule ends at the next emoji, so that emoji must still be there.
	const recurrence = take(RECURRENCE);
	if (recurrence !== undefined) {
		task.recurrence = recurrence.trim();
		sawEmoji = true;
	}

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

	rest = rest.replace(LINK_PLACEHOLDER, (_s, i: string) => linkSpans[Number(i)] ?? '');
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

export interface StatusDef {
	/** The single character between the brackets. */
	char: string;
	name: string;
	kind: StatusKind;
}

/** Defaults follow the Tasks plugin's core and common custom statuses. */
export const DEFAULT_STATUSES: StatusDef[] = [
	{ char: ' ', name: 'To do', kind: 'todo' },
	{ char: '/', name: 'In progress', kind: 'in-progress' },
	{ char: 'x', name: 'Done', kind: 'done' },
	{ char: 'X', name: 'Done', kind: 'done' },
	{ char: '-', name: 'Cancelled', kind: 'cancelled' },
	{ char: '>', name: 'Forwarded', kind: 'other' },
	{ char: '<', name: 'Scheduling', kind: 'other' },
	{ char: '?', name: 'Question', kind: 'other' },
	{ char: '!', name: 'Important', kind: 'todo' },
];

let statusTable = new Map(DEFAULT_STATUSES.map((s) => [s.char, s]));

/** Replace the status set (from settings). Space, x and - always keep their core meaning. */
export function configureStatuses(defs: StatusDef[]): void {
	const table = new Map(defs.map((s) => [s.char, s]));
	for (const core of DEFAULT_STATUSES.filter((s) => [' ', 'x', '-'].includes(s.char))) {
		const custom = table.get(core.char);
		table.set(core.char, { ...core, name: custom?.name || core.name });
	}
	statusTable = table;
}

export function statusDefs(): StatusDef[] {
	return [...statusTable.values()];
}

export function statusKind(status: string): StatusKind {
	return statusTable.get(status)?.kind ?? 'other';
}

export function statusName(status: string): string {
	return statusTable.get(status)?.name ?? `[${status}]`;
}

const KINDS: StatusKind[] = ['todo', 'in-progress', 'done', 'cancelled', 'other'];

/**
 * Parse the status setting: one status per line, `char | name | kind`, e.g. `/ | Doing | in-progress`.
 * Returns the parsed list plus messages for lines that were skipped.
 */
export function parseStatusSetting(text: string): { defs: StatusDef[]; errors: string[] } {
	const defs: StatusDef[] = [];
	const errors: string[] = [];
	text.split(/\r?\n/).forEach((line, i) => {
		if (!line.trim() || line.trim().startsWith('#')) return;
		const parts = line.split('|');
		if (parts.length !== 3) return void errors.push(`Line ${i + 1}: expected "char | name | kind".`);
		const [rawChar = '', rawName = '', rawKind = ''] = parts;
		// The character may be a space, so only trim one surrounding space on each side.
		const char = rawChar.replace(/^ (?=.)/, '').replace(/ $/, '') || ' ';
		const kind = rawKind.trim() as StatusKind;
		if ([...char].length !== 1 || char === ']') return void errors.push(`Line ${i + 1}: the status must be one character.`);
		if (!KINDS.includes(kind)) return void errors.push(`Line ${i + 1}: kind must be one of ${KINDS.join(', ')}.`);
		defs.push({ char, name: rawName.trim() || char, kind });
	});
	return { defs, errors };
}

export function formatStatusSetting(defs: StatusDef[]): string {
	return defs.map((d) => `${d.char === ' ' ? ' ' : d.char} | ${d.name} | ${d.kind}`).join('\n');
}
