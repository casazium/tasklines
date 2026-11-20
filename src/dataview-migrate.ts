// Translate a Dataview TASK query into a .base file with a Tasklines view.
// Pure and best-effort: anything it cannot translate is listed in `warnings` and written
// as a comment in the generated file, never silently dropped.

import { DEFAULT_QUERY, type DuePreset, type SortKey, type TaskQuery } from './query.ts';
import type { StatusKind } from './parser.ts';

export interface Migration {
	/** Note-level Bases filters (all must match). */
	filters: string[];
	/** Set when FROM uses OR between sources. */
	anyFilters: string[];
	query: TaskQuery;
	warnings: string[];
}

const OPEN: StatusKind[] = ['todo', 'in-progress', 'other'];

/** Split on a keyword at the top level (outside quotes and brackets), case-insensitive. */
function splitTop(text: string, word: 'AND' | 'OR'): string[] {
	const parts: string[] = [];
	let depth = 0;
	let quote: string | null = null;
	let start = 0;
	const re = new RegExp(`^\\s+${word}\\s+`, 'i');
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] ?? '';
		if (quote) {
			if (ch === '\\') i++; // skip the escaped character
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") quote = ch;
		else if ('([{'.includes(ch)) depth++;
		else if (')]}'.includes(ch)) depth--;
		else if (depth === 0) {
			const m = re.exec(text.slice(i));
			if (m && /\s/.test(ch)) {
				parts.push(text.slice(start, i));
				i += m[0].length - 1;
				start = i + 1;
			}
		}
	}
	parts.push(text.slice(start));
	return parts.map((p) => p.trim()).filter(Boolean);
}

const quoteStr = (s: string) => JSON.stringify(s);
/** A double-quoted Dataview string with backslash escapes; group 1 of the match is its body. */
const STR = '"((?:[^"\\\\]|\\\\.)*)"';
const unescape = (s: string) => s.replace(/\\(.)/g, '$1');

function translateSource(src: string, warnings: string[]): string | null {
	const s = src.trim();
	const neg = /^(?:-|!)\s*/.exec(s);
	const body = neg ? s.slice(neg[0].length) : s;
	let expr: string | null = null;
	const folder = /^"([^"]*)"$/.exec(body);
	const tag = /^#([\p{L}\p{N}_/-]+)$/u.exec(body);
	if (folder) {
		const path = folder[1] ?? '';
		expr = path.endsWith('.md') ? `file.path == ${quoteStr(path)}` : `file.inFolder(${quoteStr(path)})`;
	} else if (tag) expr = `file.hasTag(${quoteStr(tag[1] ?? '')})`;
	else if (/^\[\[.*\]\]$/.test(body)) {
		warnings.push(`FROM ${s}: link sources are not translated; add a filter on file links in the base by hand.`);
		return null;
	} else {
		warnings.push(`FROM ${s}: not recognised.`);
		return null;
	}
	return neg ? `!${expr}` : expr;
}

const REL = /^date\(\s*today\s*\)(?:\s*([+-])\s*dur\(\s*(\d+)\s*(day|days|d|week|weeks|w)\s*\))?$/i;
const ABS = /^date\(\s*(\d{4}-\d{2}-\d{2})\s*\)$/i;

/** Offset in days for `date(today) ± dur(N days|weeks)`, or null. */
function relativeDays(rhs: string): number | null {
	const m = REL.exec(rhs.trim());
	if (!m) return null;
	if (!m[1]) return 0;
	const n = Number(m[2]) * (/^w/i.test(m[3] ?? '') ? 7 : 1);
	return m[1] === '-' ? -n : n;
}

function translateWhere(clause: string, q: TaskQuery, filters: string[], warnings: string[]): void {
	const c = clause.trim().replace(/^\((.*)\)$/s, '$1').trim();
	const lower = c.toLowerCase();

	if (/^(!\s*(completed|checked|fullycompleted)|(completed|checked)\s*=\s*false)$/i.test(c)) {
		q.statuses = [...OPEN];
		return;
	}
	if (/^((completed|checked|fullycompleted)|(completed|checked)\s*=\s*true)$/i.test(c)) {
		q.statuses = ['done'];
		return;
	}
	const statusEq = /^status\s*(=|!=)\s*"(.)"$/i.exec(c);
	if (statusEq) {
		const kind: StatusKind = statusEq[2] === ' ' ? 'todo' : statusEq[2] === 'x' || statusEq[2] === 'X' ? 'done' : statusEq[2] === '-' ? 'cancelled' : statusEq[2] === '/' ? 'in-progress' : 'other';
		const all: StatusKind[] = ['todo', 'in-progress', 'done', 'cancelled', 'other'];
		q.statuses = statusEq[1] === '=' ? [kind] : all.filter((k) => k !== kind);
		if (kind === 'other') warnings.push(`WHERE ${c}: custom status "${statusEq[2]}" mapped to the "other" status group.`);
		return;
	}
	if (lower === 'due') return void (q.due = 'has');
	if (/^!\s*due$/i.test(c)) return void (q.due = 'none');

	const cmp = /^due\s*(<=|<|=|>=|>)\s*(.+)$/i.exec(c);
	if (cmp) {
		const [, op = '', rhs = ''] = cmp;
		const abs = ABS.exec(rhs.trim());
		if (abs) {
			const d = abs[1] ?? '';
			if (q.due !== 'range') {
				q.due = 'range';
				q.dueFrom = '';
				q.dueTo = '';
			}
			if (op === '=') q.dueFrom = q.dueTo = d;
			else if (op.startsWith('<')) q.dueTo = d;
			else q.dueFrom = d;
			if (op === '<' || op === '>') warnings.push(`WHERE ${c}: Tasklines date ranges are inclusive; the boundary day is included.`);
			return;
		}
		const days = relativeDays(rhs);
		if (days !== null) {
			let preset: DuePreset | null = null;
			if (days === 0 && op === '<') preset = 'overdue';
			else if (days === 0 && op === '=') preset = 'today';
			else if (op.startsWith('<') && (days === 7 || days === 30)) {
				preset = days === 7 ? 'next7' : 'next30';
				warnings.push(`WHERE ${c}: mapped to "due in next ${days} days", which leaves out overdue tasks that Dataview included. Add an "Overdue" view if you need them.`);
			}
			if (preset) return void (q.due = preset);
		}
		warnings.push(`WHERE ${c}: relative date not translated; set the due filter in the toolbar.`);
		return;
	}

	const contains = new RegExp(`^contains\\(\\s*(text|tags|file\\.name|file\\.path)\\s*,\\s*${STR}\\s*\\)$`, 'i').exec(c);
	if (contains) {
		const [, field = ''] = contains;
		const value = unescape(contains[2] ?? '');
		const f = field.toLowerCase();
		if (f === 'text') q.text = value;
		else if (f === 'tags') q.tags = [...q.tags, value.startsWith('#') ? value.toLowerCase() : `#${value.toLowerCase()}`];
		else filters.push(`${f}.contains(${quoteStr(value)})`);
		return;
	}

	// Note-level property comparisons, e.g. file.frontmatter.status = "active" or project = "Alpha".
	const prop = new RegExp(`^(?:file\\.frontmatter\\.)?([A-Za-z_][\\w-]*)\\s*(=|!=)\\s*${STR}$`).exec(c);
	if (prop && !['text', 'status', 'due', 'tags'].includes((prop[1] ?? '').toLowerCase())) {
		const op = prop[2] === '=' ? '==' : '!=';
		filters.push(`note.${prop[1]} ${op} ${quoteStr(unescape(prop[3] ?? ''))}`);
		warnings.push(`WHERE ${c}: became the note filter "note.${prop[1]} ${op} …". Dataview also matched task-level inline fields of that name; Tasklines filters notes only.`);
		return;
	}

	warnings.push(`WHERE ${c}: not translated.`);
}

const SORT_KEYS: Record<string, string> = {
	due: 'due',
	scheduled: 'scheduled',
	start: 'start',
	created: 'created',
	completion: 'done',
	priority: 'priority',
	status: 'status',
	text: 'text',
	'file.name': 'note',
	'file.link': 'note',
	line: 'position',
};

const GROUP_KEYS: Record<string, string> = {
	'file.link': 'note',
	'file.name': 'note',
	file: 'note',
	status: 'status',
	due: 'due',
	priority: 'priority',
	section: 'section',
	header: 'section',
	'meta(section).subpath': 'section',
	tags: 'tag',
};

/** Translate a Dataview TASK query. Throws if it is not a TASK query. */
export function translateDataviewTask(source: string): Migration {
	const warnings: string[] = [];
	const filters: string[] = [];
	let anyFilters: string[] = [];
	const q: TaskQuery = { ...DEFAULT_QUERY, statuses: [], sort: [], tags: [] };

	const text = source.replace(/\r\n?/g, '\n').trim();
	const head = /^task\b/i.exec(text);
	if (!head) throw new Error('Only Dataview TASK queries can be converted.');
	// Clauses start at line beginnings: FROM, WHERE, SORT, GROUP BY, LIMIT, FLATTEN.
	const clauses = text
		.slice(head[0].length)
		.split(/\n(?=\s*(?:FROM|WHERE|SORT|GROUP\s+BY|LIMIT|FLATTEN)\b)/i)
		.map((c) => c.replace(/\s+/g, ' ').trim())
		.filter(Boolean);

	for (const clause of clauses) {
		const m = /^(FROM|WHERE|SORT|GROUP BY|LIMIT|FLATTEN)\s+(.*)$/i.exec(clause);
		if (!m) {
			warnings.push(`"${clause}": not recognised.`);
			continue;
		}
		const kw = (m[1] ?? '').toUpperCase().replace(/\s+/g, ' ');
		const body = m[2] ?? '';
		if (kw === 'FROM') {
			const ors = splitTop(body, 'OR');
			if (ors.length > 1) {
				anyFilters = ors.map((s) => translateSource(s, warnings)).filter((x): x is string => !!x);
			} else {
				for (const s of splitTop(body, 'AND')) {
					const f = translateSource(s, warnings);
					if (f) filters.push(f);
				}
			}
		} else if (kw === 'WHERE') {
			if (splitTop(body, 'OR').length > 1) {
				warnings.push(`WHERE ${body}: OR conditions are not translated; build them with the base filters or several views.`);
				continue;
			}
			for (const c of splitTop(body, 'AND')) translateWhere(c, q, filters, warnings);
		} else if (kw === 'SORT') {
			for (const part of body.split(',')) {
				const sm = /^\s*([\w.()]+)\s*(asc|ascending|desc|descending)?\s*$/i.exec(part);
				const key = sm ? SORT_KEYS[(sm[1] ?? '').toLowerCase()] : undefined;
				if (!sm || !key) {
					warnings.push(`SORT ${part.trim()}: not translated.`);
					continue;
				}
				if (q.sort.length < 3) q.sort.push({ key, desc: /^desc/i.test(sm[2] ?? '') } satisfies SortKey);
				else warnings.push(`SORT ${part.trim()}: Tasklines sorts by at most 3 keys.`);
			}
		} else if (kw === 'GROUP BY') {
			const key = GROUP_KEYS[body.trim().toLowerCase()];
			if (key) q.group = key;
			else warnings.push(`GROUP BY ${body}: not translated.`);
		} else if (kw === 'LIMIT') {
			warnings.push(`LIMIT ${body}: Tasklines shows every matching task; there is no row limit.`);
		} else {
			warnings.push(`${kw} ${body}: not translated.`);
		}
	}
	return { filters, anyFilters, query: q, warnings };
}

/** Render a migration as a .base file. Untranslated parts become comments at the top. */
export function migrationToBase(m: Migration, viewName: string, original: string): string {
	const y = (s: string) => JSON.stringify(s);
	const out: string[] = [];
	out.push('# Created by Tasklines from this Dataview query:');
	for (const line of original.trim().split(/\r?\n/)) out.push(`#   ${line}`);
	if (m.warnings.length) {
		out.push('# Check these parts by hand:');
		for (const w of m.warnings) out.push(`#   - ${w}`);
	}
	if (m.filters.length || m.anyFilters.length) {
		out.push('filters:');
		out.push('  and:');
		for (const f of m.filters) out.push(`    - ${y(f)}`);
		if (m.anyFilters.length) {
			out.push('    - or:');
			for (const f of m.anyFilters) out.push(`        - ${y(f)}`);
		}
	}
	const q = m.query;
	out.push('views:');
	out.push('  - type: tasklines');
	out.push(`    name: ${y(viewName)}`);
	out.push('    order:');
	out.push('      - file.name');
	out.push('    taskQuery:');
	if (q.statuses.length) out.push(`      statuses: [${q.statuses.join(', ')}]`);
	if (q.due !== 'any') out.push(`      due: ${q.due}`);
	if (q.dueFrom) out.push(`      dueFrom: ${y(q.dueFrom)}`);
	if (q.dueTo) out.push(`      dueTo: ${y(q.dueTo)}`);
	if (q.tags.length) out.push(`      tags: [${q.tags.map(y).join(', ')}]`);
	if (q.text) out.push(`      text: ${y(q.text)}`);
	if (q.sort.length) {
		out.push('      sort:');
		for (const s of q.sort) out.push(`        - key: ${s.key}`, `          desc: ${s.desc}`);
	}
	out.push(`      group: ${q.group === 'bases' ? 'none' : q.group}`);
	return out.join('\n') + '\n';
}

/** The ```dataview block containing `cursorLine`, if any. Lines are 0-based. */
export function findDataviewBlock(lines: string[], cursorLine: number): { start: number; end: number; source: string } | null {
	const fence = /^\s*(`{3,}|~{3,})\s*(\S*)/;
	let open: { line: number; marker: string; lang: string } | null = null;
	for (let i = 0; i < lines.length; i++) {
		const m = fence.exec(lines[i] ?? '');
		if (!m) continue;
		if (!open) {
			open = { line: i, marker: m[1] ?? '```', lang: (m[2] ?? '').toLowerCase() };
		} else if ((m[1] ?? '').startsWith(open.marker) && !(m[2] ?? '')) {
			if (open.lang === 'dataview' && cursorLine >= open.line && cursorLine <= i) {
				return { start: open.line, end: i, source: lines.slice(open.line + 1, i).join('\n') };
			}
			if (open.line > cursorLine) return null;
			open = null;
		}
	}
	return null;
}
