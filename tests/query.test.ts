import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskLine } from '../src/parser.ts';
import { applyQuery, DEFAULT_QUERY, normalizeQuery, sortRows, addDays, type QueryRow, type TaskQuery } from '../src/query.ts';

const TODAY = '2026-11-20';
let lineNo = 0;
function row(line: string, note = 'A', noteIndex = 0, props: Record<string, string> = {}, baseGroup = ''): QueryRow & { id: string } {
	const parsed = parseTaskLine(line);
	assert.ok(parsed);
	const task = { ...parsed, path: `${note}.md`, line: lineNo++, depth: 0, children: [] };
	return { id: task.text.replace(/\s#\S+/g, ''), task, noteIndex, noteName: note, baseGroup, baseGroupIndex: 0, props: new Map(Object.entries(props)) };
}
const q = (over: Partial<TaskQuery>): TaskQuery => ({ ...DEFAULT_QUERY, ...over });
const ids = (groups: Array<{ rows: Array<{ id: string }> }>) => groups.flatMap((g) => g.rows.map((r) => r.id));

const ROWS = [
	row('- [ ] overdue ⏫ 📅 2026-11-01 #work', 'Alpha', 0, { 'note.owner': 'Bob', 'note.size': '10' }, 'work'),
	row('- [x] done thing 📅 2026-11-20 #work/admin', 'Alpha', 0, { 'note.owner': 'Bob', 'note.size': '10' }, 'work'),
	row('- [ ] today 🔼 📅 2026-11-20 #home', 'Beta', 1, { 'note.owner': 'Ana', 'note.size': '9' }, 'home'),
	row('- [/] soon 📅 2026-11-25', 'Beta', 1, { 'note.owner': 'Ana', 'note.size': '9' }, 'home'),
	row('- [-] cancelled', 'Gamma', 2, { 'note.size': '100' }, ''),
	row('- [ ] far 🔽 📅 2027-03-01 #home', 'Gamma', 2, { 'note.size': '100' }, ''),
];

test('default query keeps base order and one unlabeled group when base is ungrouped', () => {
	const flat = ROWS.map((r) => ({ ...r, baseGroup: '' }));
	const out = applyQuery(flat, DEFAULT_QUERY, TODAY);
	assert.equal(out.length, 1);
	assert.equal(out[0]?.label, null);
	assert.deepEqual(ids(out), ['overdue', 'done thing', 'today', 'soon', 'cancelled', 'far']);
});

test('status filter', () => {
	assert.deepEqual(ids(applyQuery(ROWS, q({ statuses: ['todo', 'in-progress'], group: 'none' }), TODAY)), ['overdue', 'today', 'soon', 'far']);
});

test('due presets', () => {
	const due = (d: TaskQuery['due'], extra: Partial<TaskQuery> = {}) => ids(applyQuery(ROWS, q({ due: d, group: 'none', ...extra }), TODAY));
	assert.deepEqual(due('overdue'), ['overdue']);
	assert.deepEqual(due('today'), ['done thing', 'today']);
	assert.deepEqual(due('next7'), ['done thing', 'today', 'soon']);
	assert.deepEqual(due('none'), ['cancelled']);
	assert.deepEqual(due('range', { dueFrom: '2026-11-21', dueTo: '2027-12-31' }), ['soon', 'far']);
});

test('priority, tag (with nesting) and text filters', () => {
	assert.deepEqual(ids(applyQuery(ROWS, q({ priorities: ['high', 'medium'], group: 'none' }), TODAY)), ['overdue', 'today']);
	assert.deepEqual(ids(applyQuery(ROWS, q({ tags: ['#work'], group: 'none' }), TODAY)), ['overdue', 'done thing']);
	assert.deepEqual(ids(applyQuery(ROWS, q({ tags: ['#WORK/admin'].map((t) => t.toLowerCase()), group: 'none' }), TODAY)), ['done thing']);
	assert.deepEqual(ids(applyQuery(ROWS, q({ text: 'SOON', group: 'none' }), TODAY)), ['soon']);
});

test('multi-key sort: priority, then due descending; empty values last', () => {
	const out = sortRows(ROWS, [{ key: 'priority', desc: false }, { key: 'due', desc: true }]);
	assert.deepEqual(out.map((r) => r.id), ['overdue', 'today', 'soon', 'done thing', 'cancelled', 'far']);
	const byDueDesc = sortRows(ROWS, [{ key: 'due', desc: true }]).map((r) => r.id);
	assert.equal(byDueDesc.at(-1), 'cancelled', 'no due date sorts last even when descending');
});

test('sort by note property is numeric-aware', () => {
	const out = sortRows(ROWS, [{ key: 'prop:note.size', desc: false }]).map((r) => r.task.path);
	assert.deepEqual([...new Set(out)], ['Beta.md', 'Alpha.md', 'Gamma.md']);
});

test('group by due bucket in fixed order', () => {
	const out = applyQuery(ROWS, q({ group: 'due' }), TODAY);
	assert.deepEqual(out.map((g) => g.label), ['Overdue', 'Today', 'Next 7 days', 'Later', 'No due date']);
});

test('group by note property, empty last', () => {
	const out = applyQuery(ROWS, q({ group: 'prop:note.owner' }), TODAY);
	assert.deepEqual(out.map((g) => g.label), ['Ana', 'Bob', '']);
});

test('group by tag puts a task under each of its tags', () => {
	const out = applyQuery(ROWS, q({ group: 'tag' }), TODAY);
	assert.deepEqual(out.map((g) => [g.label, g.rows.length]), [['#home', 2], ['#work', 1], ['#work/admin', 1], ['', 2]]);
});

test('group by bases keeps the base group order', () => {
	const out = applyQuery(ROWS, q({ group: 'bases' }), TODAY);
	assert.deepEqual(out.map((g) => g.label), ['work', 'home', '']);
});

test('normalizeQuery rejects junk from a hand-edited .base file', () => {
	const n = normalizeQuery({
		statuses: ['todo', 'bogus', 3],
		due: 'yesterday',
		dueFrom: 'not-a-date',
		priorities: ['high', 'urgent'],
		tags: ['work', ' #Home ', ''],
		sort: [{ key: 'due', desc: true }, { key: 'nope' }, { key: 'prop:note.owner' }, 'x', { key: 'text' }, { key: 'status' }],
		group: 'prop:note.area',
	});
	assert.deepEqual(n.statuses, ['todo']);
	assert.equal(n.due, 'any');
	assert.equal(n.dueFrom, '');
	assert.deepEqual(n.priorities, ['high']);
	assert.deepEqual(n.tags, ['#work', '#home']);
	assert.deepEqual(n.sort, [{ key: 'due', desc: true }, { key: 'prop:note.owner', desc: false }, { key: 'text', desc: false }]);
	assert.equal(n.group, 'prop:note.area');
	assert.deepEqual(normalizeQuery(null), DEFAULT_QUERY);
	assert.deepEqual(normalizeQuery({ group: 'prop:evil' }).group, 'bases');
});

test('addDays crosses month and year boundaries', () => {
	assert.equal(addDays('2026-12-28', 7), '2027-01-04');
	assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('activeQueryCount counts each setting that differs from the default', async () => {
	const { activeQueryCount } = await import('../src/query.ts');
	assert.equal(activeQueryCount(DEFAULT_QUERY), 0);
	assert.equal(activeQueryCount(q({ statuses: ['todo'], due: 'overdue', text: '  ' })), 2, 'blank text does not count');
	assert.equal(activeQueryCount(q({ priorities: ['high'], doneWithinDays: 7, tags: ['#a'], text: 'x', sort: [{ key: 'due', desc: false }], group: 'note', statuses: ['done'], due: 'today' })), 8);
	assert.equal(activeQueryCount(normalizeQuery({ group: 'bases' })), 0);
});
