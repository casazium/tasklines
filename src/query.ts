// Task-level filter, multi-key sort and grouping. Pure: no DOM, no Obsidian runtime.
// Note-level filtering is done by the base's own filters before rows reach here.

import type { IndexedTask } from './extract.ts';
import { statusKind, type Priority, type StatusKind } from './parser.ts';

export const STATUS_KINDS: StatusKind[] = ['todo', 'in-progress', 'done', 'cancelled', 'other'];
export const STATUS_LABELS: Record<StatusKind, string> = { todo: 'To do', 'in-progress': 'In progress', done: 'Done', cancelled: 'Cancelled', other: 'Other' };
export const PRIORITY_ORDER: Priority[] = ['highest', 'high', 'medium', 'none', 'low', 'lowest'];
export const DUE_PRESETS = ['any', 'overdue', 'today', 'next7', 'next30', 'has', 'none', 'range'] as const;
export type DuePreset = (typeof DUE_PRESETS)[number];

/** Task fields that can be sort or group keys. Note properties use `prop:<BasesPropertyId>`. */
export const TASK_SORT_KEYS = ['due', 'scheduled', 'start', 'created', 'done', 'priority', 'status', 'text', 'note', 'position'] as const;
export const TASK_GROUP_KEYS = ['bases', 'none', 'note', 'section', 'status', 'due', 'priority', 'tag'] as const;

export interface SortKey {
	key: string;
	desc: boolean;
}

export interface TaskQuery {
	/** Empty means all statuses. */
	statuses: StatusKind[];
	due: DuePreset;
	/** Inclusive YYYY-MM-DD bounds, used when due === 'range'. */
	dueFrom: string;
	dueTo: string;
	/** Empty means all priorities. */
	priorities: Priority[];
	/** Any-of match; `#area` also matches `#area/home`. Empty means no tag filter. */
	tags: string[];
	text: string;
	/** Show completed or cancelled tasks only if they finished within this many days; null shows all. */
	doneWithinDays: number | null;
	/** Applied in order; ties fall back to the base's note order, then position in the note. */
	sort: SortKey[];
	group: string;
}

export const DEFAULT_QUERY: TaskQuery = {
	statuses: [],
	due: 'any',
	dueFrom: '',
	dueTo: '',
	priorities: [],
	tags: [],
	text: '',
	doneWithinDays: null,
	sort: [],
	group: 'bases',
};

export interface QueryRow {
	task: IndexedTask;
	/** Position of the note in the base's (already sorted) result. */
	noteIndex: number;
	noteName: string;
	/** The base's own group label for this note ('' when not grouped). */
	baseGroup: string;
	/** Index of the base group, to keep the base's group order. */
	baseGroupIndex: number;
	/** Note property values as display text, keyed by property id. */
	props: ReadonlyMap<string, string>;
}

export interface RowGroup<R extends QueryRow = QueryRow> {
	/** null: a single ungrouped list with no heading. */
	label: string | null;
	rows: R[];
}

const SORT_KEY_SET = new Set<string>(TASK_SORT_KEYS);
const GROUP_KEY_SET = new Set<string>(TASK_GROUP_KEYS);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a query read from a .base file; anything unrecognised falls back to the default. */
export function normalizeQuery(raw: unknown): TaskQuery {
	const q = { ...DEFAULT_QUERY };
	if (!raw || typeof raw !== 'object') return q;
	const r = raw as Record<string, unknown>;
	const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
	q.statuses = strings(r.statuses).filter((s): s is StatusKind => (STATUS_KINDS as string[]).includes(s));
	q.priorities = strings(r.priorities).filter((p): p is Priority => (PRIORITY_ORDER as string[]).includes(p));
	if (typeof r.due === 'string' && (DUE_PRESETS as readonly string[]).includes(r.due)) q.due = r.due as DuePreset;
	if (typeof r.dueFrom === 'string' && ISO_DATE.test(r.dueFrom)) q.dueFrom = r.dueFrom;
	if (typeof r.dueTo === 'string' && ISO_DATE.test(r.dueTo)) q.dueTo = r.dueTo;
	q.tags = strings(r.tags).map(normalizeTag).filter(Boolean);
	if (typeof r.text === 'string') q.text = r.text;
	if (typeof r.doneWithinDays === 'number' && Number.isInteger(r.doneWithinDays) && r.doneWithinDays >= 0 && r.doneWithinDays <= 3650) q.doneWithinDays = r.doneWithinDays;
	if (Array.isArray(r.sort)) {
		q.sort = r.sort
			.filter((s): s is { key: string; desc?: unknown } => !!s && typeof s === 'object' && typeof (s as SortKey).key === 'string')
			.filter((s) => isValidKey(s.key, SORT_KEY_SET))
			.map((s) => ({ key: s.key, desc: s.desc === true }))
			.slice(0, 3);
	}
	if (typeof r.group === 'string' && isValidKey(r.group, GROUP_KEY_SET)) q.group = r.group;
	return q;
}

function isValidKey(key: string, taskKeys: Set<string>): boolean {
	return taskKeys.has(key) || /^prop:(note|file|formula)\..+/.test(key);
}

export function normalizeTag(tag: string): string {
	const t = tag.trim();
	if (!t) return '';
	return (t.startsWith('#') ? t : `#${t}`).toLowerCase();
}

export function addDays(isoDate: string, days: number): string {
	const [y, m, d] = isoDate.split('-').map(Number);
	const date = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD); negative if b is earlier. */
export function daysBetween(a: string, b: string): number {
	const t = (d: string) => {
		const [y, m, day] = d.split('-').map(Number);
		return Date.UTC(y ?? 1970, (m ?? 1) - 1, day ?? 1);
	};
	return Math.round((t(b) - t(a)) / 86_400_000);
}

export function matches(row: QueryRow, q: TaskQuery, today: string): boolean {
	const t = row.task;
	if (q.statuses.length && !q.statuses.includes(statusKind(t.status))) return false;
	if (q.priorities.length && !q.priorities.includes(t.priority)) return false;
	if (q.tags.length) {
		const own = t.tags.map((x) => x.toLowerCase());
		if (!q.tags.some((want) => own.some((have) => have === want || have.startsWith(`${want}/`)))) return false;
	}
	if (q.doneWithinDays !== null) {
		const kind = statusKind(t.status);
		if (kind === 'done' || kind === 'cancelled') {
			// No date means we cannot tell when it finished: treat it as outside the window.
			const finished = t.done ?? t.cancelled;
			if (!finished || daysBetween(finished, today) > q.doneWithinDays) return false;
		}
	}
	const needle = q.text.trim().toLowerCase();
	if (needle && !t.text.toLowerCase().includes(needle)) return false;
	const due = t.due;
	switch (q.due) {
		case 'any':
			break;
		case 'has':
			if (!due) return false;
			break;
		case 'none':
			if (due) return false;
			break;
		case 'overdue':
			if (!due || due >= today) return false;
			break;
		case 'today':
			if (due !== today) return false;
			break;
		case 'next7':
		case 'next30': {
			const end = addDays(today, q.due === 'next7' ? 7 : 30);
			if (!due || due < today || due > end) return false;
			break;
		}
		case 'range':
			if (!due) return false;
			if (q.dueFrom && due < q.dueFrom) return false;
			if (q.dueTo && due > q.dueTo) return false;
			break;
	}
	return true;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Compare two optional strings; empty values always sort last, whatever the direction. */
function compareText(a: string | undefined, b: string | undefined, desc: boolean): number {
	const ea = !a;
	const eb = !b;
	if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
	const c = collator.compare(a, b);
	return desc ? -c : c;
}

function compareBy(a: QueryRow, b: QueryRow, s: SortKey): number {
	const dir = s.desc ? -1 : 1;
	switch (s.key) {
		case 'due':
		case 'scheduled':
		case 'start':
		case 'created':
		case 'done':
			return compareText(a.task[s.key], b.task[s.key], s.desc);
		case 'priority':
			return dir * (PRIORITY_ORDER.indexOf(a.task.priority) - PRIORITY_ORDER.indexOf(b.task.priority));
		case 'status':
			return dir * (STATUS_KINDS.indexOf(statusKind(a.task.status)) - STATUS_KINDS.indexOf(statusKind(b.task.status)));
		case 'text':
			return compareText(a.task.text, b.task.text, s.desc);
		case 'note':
			return compareText(a.noteName, b.noteName, s.desc);
		case 'position':
			return dir * (a.noteIndex - b.noteIndex || a.task.line - b.task.line);
		default: {
			const prop = s.key.slice('prop:'.length);
			return compareText(a.props.get(prop), b.props.get(prop), s.desc);
		}
	}
}

export function sortRows<R extends QueryRow>(rows: R[], keys: SortKey[]): R[] {
	return [...rows].sort((a, b) => {
		for (const k of keys) {
			const c = compareBy(a, b, k);
			if (c) return c;
		}
		return a.noteIndex - b.noteIndex || a.task.line - b.task.line;
	});
}

const DUE_BUCKETS = ['Overdue', 'Today', 'Next 7 days', 'Later', 'No due date'];

function groupLabels(row: QueryRow, key: string, today: string): string[] {
	const t = row.task;
	switch (key) {
		case 'note':
			return [row.noteName];
		case 'section':
			return [t.section ?? ''];
		case 'status':
			return [STATUS_LABELS[statusKind(t.status)]];
		case 'priority':
			return [t.priority];
		case 'tag':
			// A task with several tags appears under each of them.
			return t.tags.length ? t.tags : [''];
		case 'due':
			if (!t.due) return ['No due date'];
			if (t.due < today) return ['Overdue'];
			if (t.due === today) return ['Today'];
			return [t.due <= addDays(today, 7) ? 'Next 7 days' : 'Later'];
		case 'bases':
			return [row.baseGroup];
		default:
			return [row.props.get(key.slice('prop:'.length)) ?? ''];
	}
}

function groupOrder(key: string, groups: Map<string, { first: QueryRow }>): string[] {
	const labels = [...groups.keys()];
	const fixed = (order: readonly string[]) => labels.sort((a, b) => order.indexOf(a) - order.indexOf(b));
	switch (key) {
		case 'due':
			return fixed(DUE_BUCKETS);
		case 'priority':
			return fixed(PRIORITY_ORDER);
		case 'status':
			return fixed(STATUS_KINDS.map((k) => STATUS_LABELS[k]));
		case 'bases':
			return labels.sort((a, b) => (groups.get(a)?.first.baseGroupIndex ?? 0) - (groups.get(b)?.first.baseGroupIndex ?? 0));
		case 'note':
			return labels.sort((a, b) => (groups.get(a)?.first.noteIndex ?? 0) - (groups.get(b)?.first.noteIndex ?? 0));
		default:
			// Alphabetical, empty last.
			return labels.sort((a, b) => compareText(a, b, false));
	}
}

/** Filter, sort and group rows. Rows keep their sorted order inside each group. */
export function applyQuery<R extends QueryRow>(rows: R[], q: TaskQuery, today: string): RowGroup<R>[] {
	const sorted = sortRows(
		rows.filter((r) => matches(r, q, today)),
		q.sort,
	);
	if (q.group === 'none') return [{ label: null, rows: sorted }];

	const groups = new Map<string, { first: R; rows: R[] }>();
	for (const r of sorted) {
		for (const label of groupLabels(r, q.group, today)) {
			const g = groups.get(label);
			if (g) g.rows.push(r);
			else groups.set(label, { first: r, rows: [r] });
		}
	}
	// No base grouping configured: one unlabeled list.
	if (q.group === 'bases' && groups.size <= 1 && (groups.has('') || groups.size === 0)) {
		return [{ label: null, rows: sorted }];
	}
	return groupOrder(q.group, groups).map((label) => ({ label, rows: groups.get(label)?.rows ?? [] }));
}

export interface Summary {
	total: number;
	open: number;
	done: number;
	cancelled: number;
	overdue: number;
}

/** Counts for a set of rows: shown in group headers and the stats line. */
export function summarize(rows: Array<{ task: IndexedTask }>, today: string): Summary {
	const s: Summary = { total: rows.length, open: 0, done: 0, cancelled: 0, overdue: 0 };
	for (const { task } of rows) {
		const kind = statusKind(task.status);
		if (kind === 'done') s.done++;
		else if (kind === 'cancelled') s.cancelled++;
		else {
			s.open++;
			if (task.due && task.due < today) s.overdue++;
		}
	}
	return s;
}

/** "12 open · 3 overdue · 5 done (29%)" — cancelled tasks are left out of the percentage. */
export function formatSummary(s: Summary): string {
	const parts = [`${s.open} open`];
	if (s.overdue) parts.push(`${s.overdue} overdue`);
	const finished = s.open + s.done;
	if (s.done) parts.push(`${s.done} done${finished ? ` (${Math.round((100 * s.done) / finished)}%)` : ''}`);
	if (s.cancelled) parts.push(`${s.cancelled} cancelled`);
	return parts.join(' · ');
}

/** How many toolbar settings differ from the defaults (shown on the collapsed toolbar's button). */
export function activeQueryCount(q: TaskQuery): number {
	return [
		q.statuses.length > 0,
		q.priorities.length > 0,
		q.due !== 'any',
		q.doneWithinDays !== null,
		q.tags.length > 0,
		q.text.trim() !== '',
		q.sort.length > 0,
		q.group !== DEFAULT_QUERY.group,
	].filter(Boolean).length;
}
