// Property tests: random task lines and notes, checked against the rules write-back must always
// keep. Seeded, so a failure can be replayed exactly:
//   FUZZ_SEED=123 FUZZ_CASES=200000 node --test tests/fuzz.test.ts
// Every failure found here becomes a fixture in tests/fixtures/task-lines.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskLine, statusKind, type Priority } from '../src/parser.ts';
import { editInContent, insertTaskInContent, splitLines, toggleInContent, type ToggleOptions } from '../src/writeback.ts';
import type { TaskEdit } from '../src/edit.ts';

const CASES = Number(process.env.FUZZ_CASES ?? 3000);
const SEED = Number(process.env.FUZZ_SEED ?? 20261120);

function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type R = () => number;
const pick = <T>(r: R, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const chance = (r: R, p: number) => r() < p;

const INDENTS = ['', '', '', '  ', '    ', '\t', '\t\t', ' \t', '> ', '>', '> > ', '>  ', '  > '];
const MARKERS = ['-', '-', '-', '*', '+', '1.', '12)', '3.'];
const STATUSES = [' ', ' ', ' ', 'x', 'X', '/', '-', '>', '<', '?', '!', 'é'];
const WORDS = [
	'Ship', 'the', 'report', 'naïve', '日本語', '🚀', 'émoji', 'a|b', 'C++', '$x$', '**bold**', '_it_', '(paren)', '::', 'x::y',
	'[link](https://example.com/📅)', '[[Note]]', '[[Note|alias]]', '[[Note#Head]]', '#tag', '#tag/sub', '#2026', 'http://x.y/?a=b&c=d',
	'%%comment%%', '<br>', ' ', '​', '—', '“quoted”', "it's", '[ ]', '[x]', '- [ ]', '\\', '\\[', '^not-id', 'end^', '1.', '#',
	'`code`', '`📅 2026-01-01`', '`[due:: 2026-01-01]`', '``a ` b``', '`🔁 every day`', 'x'.repeat(120), '2026-11-25', '📅', '✅', '🔁',
];
const EMOJI_FIELDS = [
	'📅 2026-11-25', '📅 2026-12-31', '📆 2026-11-25', '📅️ 2026-11-25', '⏳ 2026-11-19', '⌛ 2026-11-19', '🛫 2026-11-18', '➕ 2026-11-01',
	'🔺', '⏫', '🔼', '🔽', '⏬', '🔁 every week', '🔁 every 2 days when done', '🔁 every month on the 1st', '🆔 abc123', '⛔ abc123,def456',
	'🏁 delete', '🏁 keep',
];
const DONE_EMOJI = ['✅ 2026-11-19', '❌ 2026-11-19'];
const DV_FIELDS = [
	'[due:: 2026-11-25]', '[scheduled:: 2026-11-19]', '[start:: 2026-11-18]', '[created:: 2026-11-01]', '(priority:: high)', '[priority:: low]',
	'[repeat:: every week]', '[owner:: Bob]', '(area:: home)', '[id:: abc]', '[dependsOn:: abc]',
];
const DV_DONE = ['[completion:: 2026-11-19]', '[cancelled:: 2026-11-19]'];
const SPACES = [' ', ' ', ' ', '  ', '\t'];

function genLine(r: R): string {
	const style = pick(r, ['emoji', 'emoji', 'dataview', 'plain', 'mixed'] as const);
	const status = pick(r, STATUSES);
	const tokens: string[] = [];
	const nWords = 1 + Math.floor(r() * 5);
	for (let i = 0; i < nWords; i++) tokens.push(pick(r, WORDS));
	const nFields = Math.floor(r() * 4);
	for (let i = 0; i < nFields; i++) {
		if (style === 'emoji' || (style === 'mixed' && chance(r, 0.5))) tokens.push(pick(r, EMOJI_FIELDS));
		if (style === 'dataview' || (style === 'mixed' && chance(r, 0.5))) tokens.push(pick(r, DV_FIELDS));
	}
	if (statusKind(status) === 'done' && chance(r, 0.6)) tokens.push(style === 'dataview' ? DV_DONE[0] as string : DONE_EMOJI[0] as string);
	if (statusKind(status) === 'cancelled' && chance(r, 0.6)) tokens.push(style === 'dataview' ? DV_DONE[1] as string : DONE_EMOJI[1] as string);
	// Words sometimes come after the fields too.
	if (chance(r, 0.3)) tokens.push(pick(r, WORDS));
	let body = tokens.map((t, i) => (i ? pick(r, SPACES) : '') + t).join('');
	if (chance(r, 0.2)) body += ` ^blk-${Math.floor(r() * 100)}`;
	if (chance(r, 0.15)) body += pick(r, [' ', '  ', '\t']);
	return `${pick(r, INDENTS)}${pick(r, MARKERS)} [${status}] ${body}`;
}

function genDoc(r: R, target: string): { doc: string; line: number } {
	const before = Math.floor(r() * 4);
	const after = Math.floor(r() * 4);
	const filler = () => pick(r, ['', '# Heading', 'Some prose 📅 2026-01-01.', '- plain bullet', '  - nested bullet', '- [ ] Other task 📅 2026-11-30', '> quote', '```', '---', '| a | b |']);
	const lines = [...Array.from({ length: before }, filler), target, ...Array.from({ length: after }, filler)];
	// LF and CRLF may mix; a lone CR only appears in files that use it throughout (CR then an
	// empty LF line would read as one CRLF).
	const allCr = chance(r, 0.05);
	const eol = () => (allCr ? '\r' : pick(r, ['\n', '\n', '\r\n', '\r\n']));
	const lastHasEol = chance(r, 0.7);
	const doc = lines.map((l, i) => l + (i < lines.length - 1 || lastHasEol ? eol() : '')).join('');
	return { doc, line: before };
}

// Words of a description, ignoring emoji, dates and spacing: a stray bare 🔁 can move between
// text and metadata, and clearing a date also removes a repeated copy of it.
const wordsOf = (s: string) => s.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/\s+/g, ' ').trim();
const codeSpans = (s: string) => s.match(/`+[^`]*`+/g) ?? [];

function sameOutside(doc: string, out: string, line: number, label: string): void {
	const a = splitLines(doc);
	const b = splitLines(out);
	assert.equal(b.length, a.length, `${label}: line count`);
	a.forEach((x, i) => {
		if (i === line) assert.equal(b[i]?.eol, x.eol, `${label}: target line ending`);
		else assert.deepEqual(b[i], x, `${label}: line ${i} untouched`);
	});
}

function keepsFormat(before: string, after: string, label: string): void {
	const p = parseTaskLine(before);
	if (!p) return;
	if (p.format === 'dataview') assert.ok(!/[✅❌📅⏳🛫➕🔺⏫🔼🔽⏬🔁]/u.test(after.replace(before, '')) || /[✅❌📅⏳🛫➕🔺⏫🔼🔽⏬🔁]/u.test(before), `${label}: Dataview line got emoji`);
	if (p.format === 'tasks-emoji') assert.ok(!/\[(completion|cancelled|due|scheduled|start|priority)::/.test(after) || /\[(completion|cancelled|due|scheduled|start|priority)::/.test(before), `${label}: emoji line got a Dataview field`);
}

const BASE: ToggleOptions = { today: '2026-11-20', completionDate: 'auto', plainGetsEmojiDate: false, newFieldFormat: 'tasks-emoji' };
const PRIORITY_VALUES: Priority[] = ['highest', 'high', 'medium', 'none', 'low', 'lowest'];

test(`fuzz: ${CASES} random task lines (seed ${SEED})`, () => {
	const r = rng(SEED);
	const stats = { parsed: 0, toggled: 0, refused: 0, toggleRefused: 0, edited: 0, editRefused: 0, inserted: 0, roundTrips: 0 };
	for (let n = 0; n < CASES; n++) {
		const raw = genLine(r);
		const label = `case ${n}: ${JSON.stringify(raw)}`;

		// 1. The parser never throws and is fast.
		const t0 = performance.now();
		const task = parseTaskLine(raw);
		assert.ok(performance.now() - t0 < 50, `${label}: parse took too long`);
		if (!task) continue;
		stats.parsed++;
		assert.equal(task.raw, raw, `${label}: raw kept`);

		const opts: ToggleOptions = { ...BASE, plainGetsEmojiDate: chance(r, 0.5), completionDate: chance(r, 0.85) ? 'auto' : 'off', newFieldFormat: chance(r, 0.5) ? 'tasks-emoji' : 'dataview' };
		const { doc, line } = genDoc(r, raw);
		const ref = { line, raw };

		// 2. Toggle (built-in): only the target line changes, and it stays a task in its own format.
		const t = toggleInContent(doc, ref, opts);
		if (!t.ok) {
			stats.refused++;
			if (t.reason === 'invalid-edit') {
				stats.toggleRefused++;
				if (process.env.FUZZ_SHOW) console.log('toggle refused', JSON.stringify(raw), t.detail);
			} else {
				assert.equal(t.reason, 'recurring-needs-tasks', `${label}: unexpected refusal ${t.reason}: ${t.detail}`);
				assert.ok(task.recurrence && !['done', 'cancelled'].includes(statusKind(task.status)), `${label}: refused a non-recurring task`);
			}
		} else {
			stats.toggled++;
			sameOutside(doc, t.content, line, label);
			const outLine = splitLines(t.content)[line]?.text ?? '';
			const p = parseTaskLine(outLine);
			assert.ok(p, `${label}: toggled line is still a task: ${JSON.stringify(outLine)}`);
			assert.equal(p.indent + p.marker, task.indent + task.marker, `${label}: indent and marker kept`);
			const wasOpen = !['done', 'cancelled'].includes(statusKind(task.status));
			assert.equal(['done', 'cancelled'].includes(statusKind(p.status)), wasOpen, `${label}: status flipped`);
			assert.deepEqual(codeSpans(outLine), codeSpans(raw), `${label}: inline code untouched`);
			keepsFormat(raw, outLine, label);

			// 3. Round trip: tick then untick restores an open task (minus trailing spaces trimmed before a date).
			if (task.status === ' ' && !task.recurrence && !task.done && !task.cancelled) {
				const back = toggleInContent(t.content, { line, raw: outLine }, opts);
				assert.ok(back.ok, `${label}: untick refused`);
				const backLine = splitLines(back.content)[line]?.text;
				// Exact, or (when a date was appended at the end) minus trailing spaces trimmed first.
				const ok = backLine === raw || (outLine.includes('2026-11-20') && backLine === raw.replace(/\s+$/, ''));
				assert.ok(ok, `${label}: round trip gave ${JSON.stringify(backLine)}`);
				sameOutside(doc, back.content, line, `${label}: round trip`);
				stats.roundTrips++;
			}
		}

		// 4. Edits: only the target line changes, the value lands, and the format is kept.
		const edit: TaskEdit = pick(r, [
			() => ({ kind: 'date', field: pick(r, ['due', 'scheduled', 'start'] as const), value: chance(r, 0.25) ? null : pick(r, ['2026-12-01', '2027-01-31']) }),
			() => ({ kind: 'priority', value: pick(r, PRIORITY_VALUES) }),
			() => ({ kind: 'status', value: pick(r, [' ', 'x', '/', '-', '?']) }),
		])() as TaskEdit;
		const e = editInContent(doc, ref, edit, opts);
		if (!e.ok) {
			stats.editRefused++;
			assert.equal(e.reason, 'invalid-edit', `${label}: unexpected edit refusal ${e.reason}`);
			if (process.env.FUZZ_SHOW) console.log('edit refused', JSON.stringify(raw), JSON.stringify(edit), e.detail);
		} else {
			stats.edited++;
			sameOutside(doc, e.content, line, `${label} edit ${JSON.stringify(edit)}`);
			const outLine = splitLines(e.content)[line]?.text ?? '';
			const p = parseTaskLine(outLine);
			assert.ok(p, `${label}: edited line is a task`);
			assert.equal(p.indent + p.marker, task.indent + task.marker, `${label}: indent and marker kept after edit`);
			if (edit.kind === 'date') assert.equal(p[edit.field], edit.value ?? undefined, `${label}: ${edit.field} set to ${edit.value} → ${JSON.stringify(outLine)}`);
			if (edit.kind === 'priority') assert.equal(p.priority, edit.value, `${label}: priority ${edit.value} → ${JSON.stringify(outLine)}`);
			if (edit.kind === 'status') assert.equal(p.status, edit.value, `${label}: status ${JSON.stringify(edit.value)}`);
			assert.deepEqual(codeSpans(outLine), codeSpans(raw), `${label}: inline code untouched by edit`);
			assert.equal(wordsOf(p.text), wordsOf(task.text), `${label}: description kept by ${JSON.stringify(edit)} → ${JSON.stringify(outLine)}`);
			keepsFormat(raw, outLine, `${label} edit`);
		}

		// 5. Insert after this task: exactly one line is added and every existing line is kept.
		const words = Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(r, WORDS)).join(' ');
		const newTask = { text: chance(r, 0.1) ? `${words}\nsecond line` : words, due: chance(r, 0.4) ? '2026-12-24' : undefined, priority: chance(r, 0.3) ? pick(r, PRIORITY_VALUES) : undefined };
		const ins = insertTaskInContent(doc, ref, newTask, opts);
		if (ins.ok) {
			stats.inserted++;
			const a = splitLines(doc).map((l) => l.text);
			const b = splitLines(ins.content).map((l) => l.text);
			assert.equal(b.length, a.length + 1, `${label}: insert adds one line`);
			assert.deepEqual([...b.slice(0, ins.line), ...b.slice(ins.line + 1)], a, `${label}: insert keeps every line`);
			const p = parseTaskLine(ins.newLine);
			assert.ok(p, `${label}: inserted line is a task`);
			assert.equal(p.status, ' ', `${label}: new task is open`);
			if (newTask.due) assert.equal(p.due, newTask.due, `${label}: new task due → ${JSON.stringify(ins.newLine)}`);
		}
	}
	// Enough of the generated lines must exercise each path for the run to mean anything.
	assert.ok(stats.parsed > CASES * 0.8, `parsed ${stats.parsed}`);
	assert.ok(stats.toggled > CASES * 0.5 && stats.edited > CASES * 0.5 && stats.inserted > CASES * 0.5 && stats.roundTrips > CASES * 0.05, JSON.stringify(stats));
	// Refusing is safe but should stay rare: these are only the oddest generated lines.
	assert.ok(stats.toggleRefused < stats.parsed * 0.02 && stats.editRefused < stats.parsed * 0.05, JSON.stringify(stats));
	if (process.env.FUZZ_CASES) console.log('fuzz stats', stats);
});
