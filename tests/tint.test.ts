// The views' Color option: which tasks get a tint, which tone, and the words that go with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskLine } from '../src/parser.ts';
import { normalizeColorBy, tintAlreadySaid, tintFor, toneFor, TONES, type ColorBy, type Tint } from '../src/tint.ts';

const TODAY = '2026-11-20';
function row(line: string, props: Record<string, string> = {}) {
	const parsed = parseTaskLine(line);
	assert.ok(parsed, line);
	return { task: { ...parsed, path: 'A.md', line: 0, depth: 0, children: [] }, props: new Map(Object.entries(props)) };
}
const tint = (line: string, by: ColorBy, props: Record<string, string> = {}, property: { id: string; name: string } | null = null) => tintFor(row(line, props), by, TODAY, property);

test('due date: overdue is red, due today is orange, later and undated are not tinted', () => {
	assert.deepEqual(tint('- [ ] a 📅 2026-11-19', 'due'), { kind: 'overdue', tone: 'red', label: 'overdue' });
	assert.deepEqual(tint('- [ ] a 📅 2026-11-20', 'due'), { kind: 'today', tone: 'orange', label: 'due today' });
	assert.equal(tint('- [ ] a 📅 2026-11-21', 'due'), null);
	assert.equal(tint('- [ ] a', 'due'), null);
});

test('due date: Dataview fields and in-progress tasks count too', () => {
	assert.deepEqual(tint('- [ ] a [due:: 2026-11-01]', 'due'), { kind: 'overdue', tone: 'red', label: 'overdue' });
	assert.deepEqual(tint('- [/] a 📅 2026-11-01', 'due'), { kind: 'overdue', tone: 'red', label: 'overdue' });
});

test('due date: finished tasks are never tinted', () => {
	assert.equal(tint('- [x] a 📅 2026-11-01 ✅ 2026-11-02', 'due'), null);
	assert.equal(tint('- [-] a 📅 2026-11-01', 'due'), null);
});

test('priority: each level has its own tone, and no priority means no tint', () => {
	assert.deepEqual(tint('- [ ] a 🔺', 'priority'), { kind: 'priority', tone: 'red', label: 'highest priority' });
	assert.deepEqual(tint('- [ ] a ⏫', 'priority'), { kind: 'priority', tone: 'orange', label: 'high priority' });
	assert.deepEqual(tint('- [ ] a 🔼', 'priority'), { kind: 'priority', tone: 'yellow', label: 'medium priority' });
	assert.deepEqual(tint('- [ ] a 🔽', 'priority'), { kind: 'priority', tone: 'blue', label: 'low priority' });
	assert.deepEqual(tint('- [ ] a ⏬', 'priority'), { kind: 'priority', tone: 'cyan', label: 'lowest priority' });
	assert.equal(tint('- [ ] a', 'priority'), null);
	assert.deepEqual(tint('- [ ] a [priority:: high]', 'priority'), { kind: 'priority', tone: 'orange', label: 'high priority' });
	assert.equal(tint('- [x] a ⏫', 'priority'), null, 'finished');
});

test('note property: the same value gets the same tone, and the words name the property', () => {
	const area = { id: 'note.area', name: 'area' };
	const a = tint('- [ ] a', 'property', { 'note.area': 'home' }, area);
	const b = tint('- [x] b', 'property', { 'note.area': 'home' }, area);
	assert.deepEqual(a, { kind: 'property', tone: toneFor('home'), label: 'area: home' });
	assert.deepEqual(b, a, 'finished tasks are tinted by their note too');
});

test('note property: no property chosen, a missing value or a blank one means no tint', () => {
	assert.equal(tint('- [ ] a', 'property', { 'note.area': 'home' }, null), null);
	assert.equal(tint('- [ ] a', 'property', {}, { id: 'note.area', name: 'area' }), null);
	assert.equal(tint('- [ ] a', 'property', { 'note.area': '   ' }, { id: 'note.area', name: 'area' }), null);
});

test('None and unknown modes tint nothing', () => {
	assert.equal(tint('- [ ] a 📅 2026-11-01 ⏫', 'none'), null);
	assert.equal(tintFor(row('- [ ] a 📅 2026-11-01'), 'bogus' as ColorBy, TODAY), null);
});

test('toneFor is stable, ignores case, and spreads values over every tone', () => {
	assert.equal(toneFor('Home'), toneFor('home'));
	assert.equal(toneFor('work'), toneFor('work'));
	assert.ok(TONES.includes(toneFor('')));
	assert.ok(TONES.includes(toneFor('日本語 ✨')));
	const seen = new Set(Array.from({ length: 200 }, (_, i) => toneFor(`value ${i}`)));
	assert.equal(seen.size, TONES.length - 1, 'every tone but red');
	assert.ok(!seen.has('red'), 'red is kept for overdue and highest priority');
});

test('normalizeColorBy accepts only the four modes', () => {
	for (const m of ['none', 'due', 'priority', 'property']) assert.equal(normalizeColorBy(m), m);
	for (const bad of [undefined, null, '', 'Due', 'red', 3, {}]) assert.equal(normalizeColorBy(bad), 'none');
});

test('due date: a date that does not exist is not tinted', () => {
	assert.equal(tint('- [ ] a [due:: 2026-02-30]', 'due'), null);
	assert.equal(tint('- [ ] a 📅 2026-13-01', 'due'), null);
});

const T = (kind: Tint['kind'], label: string = kind): Tint => ({ kind, tone: 'red', label });

test('list rows: priority is already said only by a shown Priority column; overdue and today never are', () => {
	assert.equal(tintAlreadySaid(T('priority', 'high priority'), { view: 'list', priorityColumn: true }), true);
	assert.equal(tintAlreadySaid(T('priority', 'high priority'), { view: 'list', priorityColumn: false }), false);
	assert.equal(tintAlreadySaid(T('overdue'), { view: 'list', priorityColumn: true }), false);
	assert.equal(tintAlreadySaid(T('today', 'due today'), { view: 'list', priorityColumn: true }), false);
});

test('board cards: overdue and priority are always said; today only on the due-date board', () => {
	for (const field of ['status', 'priority', 'due'] as const) {
		assert.equal(tintAlreadySaid(T('overdue'), { view: 'board', field }), true, field);
		assert.equal(tintAlreadySaid(T('priority', 'low priority'), { view: 'board', field }), true, field);
	}
	assert.equal(tintAlreadySaid(T('today', 'due today'), { view: 'board', field: 'due' }), true);
	assert.equal(tintAlreadySaid(T('today', 'due today'), { view: 'board', field: 'status' }), false);
});

test('calendar chips: only a calendar of due dates already says overdue and today', () => {
	assert.equal(tintAlreadySaid(T('overdue'), { view: 'calendar', field: 'due' }), true);
	assert.equal(tintAlreadySaid(T('today', 'due today'), { view: 'calendar', field: 'due' }), true);
	assert.equal(tintAlreadySaid(T('overdue'), { view: 'calendar', field: 'scheduled' }), false, 'its overdue mark is about the scheduled date');
	assert.equal(tintAlreadySaid(T('priority', 'high priority'), { view: 'calendar', field: 'due' }), false, 'chips show no priority');
});

test('a note property is never taken as already said, whatever its words', () => {
	const t = tint('- [ ] a', 'property', { 'note.type': 'high priority' }, { id: 'note.type', name: 'type' });
	assert.ok(t);
	assert.equal(t.label, 'type: high priority');
	for (const place of [{ view: 'list', priorityColumn: true }, { view: 'board', field: 'priority' }, { view: 'calendar', field: 'due' }] as const) {
		assert.equal(tintAlreadySaid(t, place), false, place.view);
	}
});
