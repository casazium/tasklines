// Two-level grouping: a second "then" level inside each group of the list view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskLine } from '../src/parser.ts';
import { activeQueryCount, applyQuery, DEFAULT_QUERY, normalizeQuery, type QueryRow, type RowGroup, type TaskQuery } from '../src/query.ts';

const TODAY = '2026-11-20';
let lineNo = 0;
function row(line: string, note: string, noteIndex: number, props: Record<string, string> = {}, baseGroup = '', section?: string): QueryRow & { id: string } {
	const parsed = parseTaskLine(line);
	assert.ok(parsed);
	const task = { ...parsed, path: `${note}.md`, line: lineNo++, depth: 0, children: [], section };
	return { id: task.text.replace(/\s#\S+/g, ''), task, noteIndex, noteName: note, baseGroup, baseGroupIndex: baseGroup === 'work' ? 0 : baseGroup === 'home' ? 1 : 2, props: new Map(Object.entries(props)) };
}
const q = (over: Partial<TaskQuery>): TaskQuery => ({ ...DEFAULT_QUERY, ...over });
type R = QueryRow & { id: string };
/** [label, [sublabel, ids…]…] for checking both levels at once. */
const shape = (groups: RowGroup<R>[]) => groups.map((g) => (g.subgroups ? [g.label, g.subgroups.map((s) => [s.label, ...s.rows.map((r) => r.id)])] : [g.label, g.rows.map((r) => r.id)]));

const ROWS = [
	row('- [ ] overdue ⏫ 📅 2026-11-01 #work', 'Alpha', 0, { 'note.area': 'work' }, 'work', 'Plan'),
	row('- [x] done thing 📅 2026-11-20 #work #urgent', 'Alpha', 0, { 'note.area': 'work' }, 'work', 'Plan'),
	row('- [ ] today 🔼 📅 2026-11-20 #home', 'Beta', 1, { 'note.area': 'home' }, 'home', 'Errands'),
	row('- [/] soon 📅 2026-11-25', 'Beta', 1, { 'note.area': 'home' }, 'home'),
	row('- [ ] far 🔽 📅 2027-03-01 #home', 'Gamma', 2, {}, '', 'Errands'),
];

test('note, then status: each note split by status, in status order', () => {
	const out = applyQuery(ROWS, q({ group: 'note', subgroup: 'status' }), TODAY);
	assert.deepEqual(shape(out), [
		['Alpha', [['To do', 'overdue'], ['Done', 'done thing']]],
		['Beta', [['To do', 'today'], ['In progress', 'soon']]],
		['Gamma', [['To do', 'far']]],
	]);
});

test('a group keeps all its rows for its summary and its checkbox', () => {
	const out = applyQuery(ROWS, q({ group: 'note', subgroup: 'status' }), TODAY);
	assert.deepEqual(out[0]?.rows.map((r) => r.id), ['overdue', 'done thing']);
});

test('subgroups keep the sort order inside each one', () => {
	const out = applyQuery(ROWS, q({ group: 'status', subgroup: 'note', sort: [{ key: 'due', desc: true }] }), TODAY);
	const todo = out.find((g) => g.label === 'To do');
	assert.deepEqual(
		todo?.subgroups?.map((s) => [s.label, s.rows.map((r) => r.id)]),
		[
			['Alpha', ['overdue']],
			['Beta', ['today']],
			['Gamma', ['far']],
		],
	);
});

test('due bucket, then a note property, with an empty value last', () => {
	const out = applyQuery(ROWS, q({ group: 'due', subgroup: 'prop:note.area' }), TODAY);
	assert.deepEqual(shape(out), [
		['Overdue', [['work', 'overdue']]],
		['Today', [['home', 'today'], ['work', 'done thing']]],
		['Next 7 days', [['home', 'soon']]],
		['Later', [['', 'far']]],
	]);
});

test('tag as the second level puts a task under each of its tags', () => {
	const out = applyQuery(ROWS, q({ group: 'note', subgroup: 'tag' }), TODAY);
	assert.deepEqual(shape(out)[0], ['Alpha', [['#urgent', 'done thing'], ['#work', 'overdue', 'done thing']]]);
});

test('base grouping as the second level keeps the base order', () => {
	const out = applyQuery(ROWS, q({ group: 'status', subgroup: 'bases' }), TODAY);
	assert.deepEqual(out.find((g) => g.label === 'To do')?.subgroups?.map((s) => s.label), ['work', 'home', '']);
});

test('section as the second level, with tasks outside a section in an empty group', () => {
	const out = applyQuery(ROWS, q({ group: 'note', subgroup: 'section' }), TODAY);
	assert.deepEqual(shape(out)[1], ['Beta', [['Errands', 'today'], ['', 'soon']]]);
});

// Negative and edge cases.

test('no second level by default, and the shape is unchanged', () => {
	const out = applyQuery(ROWS, q({ group: 'note' }), TODAY);
	assert.ok(out.every((g) => g.subgroups === undefined));
	assert.deepEqual(out.map((g) => g.label), ['Alpha', 'Beta', 'Gamma']);
});

test('the same key twice is one level', () => {
	const out = applyQuery(ROWS, q({ group: 'status', subgroup: 'status' }), TODAY);
	assert.ok(out.every((g) => g.subgroups === undefined));
});

test('"No grouping" ignores a second level left in a hand-edited .base file', () => {
	const out = applyQuery(ROWS, q({ group: 'none', subgroup: 'status' }), TODAY);
	assert.deepEqual(out.map((g) => g.label), [null]);
	assert.equal(out[0]?.rows.length, ROWS.length);
	assert.equal(activeQueryCount(q({ group: 'none', subgroup: 'status' })), 1, 'only "No grouping" counts');
});

test('a base without groups as the first level: the second level takes its place', () => {
	const flat = ROWS.map((r) => ({ ...r, baseGroup: '' }));
	const out = applyQuery(flat, q({ group: 'bases', subgroup: 'note' }), TODAY);
	assert.deepEqual(out.map((g) => g.label), ['Alpha', 'Beta', 'Gamma']);
});

test('a base without groups as the second level leaves each group whole', () => {
	const flat = ROWS.map((r) => ({ ...r, baseGroup: '' }));
	const out = applyQuery(flat, q({ group: 'note', subgroup: 'bases' }), TODAY);
	assert.ok(out.every((g) => g.subgroups === undefined));
	assert.deepEqual(out.map((g) => g.rows.length), [2, 2, 1]);
});

test('filters apply before both levels, and empty groups are not made', () => {
	const out = applyQuery(ROWS, q({ group: 'note', subgroup: 'status', statuses: ['done'] }), TODAY);
	assert.deepEqual(shape(out), [['Alpha', [['Done', 'done thing']]]]);
	assert.deepEqual(applyQuery(ROWS, q({ group: 'note', subgroup: 'status', text: 'no such task' }), TODAY), []);
});

test('every shown task appears under exactly one subgroup per group (no tags involved)', () => {
	for (const group of ['note', 'status', 'due', 'priority', 'section', 'bases']) {
		for (const subgroup of ['note', 'status', 'due', 'priority', 'section', 'bases', 'prop:note.area']) {
			const out = applyQuery(ROWS, q({ group, subgroup }), TODAY);
			for (const g of out) {
				const inSubs = (g.subgroups ?? [{ label: null, rows: g.rows }]).flatMap((s) => s.rows.map((r) => r.id)).sort();
				assert.deepEqual(inSubs, g.rows.map((r) => r.id).sort(), `${group} then ${subgroup}, group ${g.label}`);
			}
		}
	}
});

test('normalizeQuery keeps a valid second level and drops a bad one', () => {
	assert.equal(normalizeQuery({ group: 'note', subgroup: 'status' }).subgroup, 'status');
	assert.equal(normalizeQuery({ group: 'note', subgroup: 'prop:note.area' }).subgroup, 'prop:note.area');
	assert.equal(normalizeQuery({ subgroup: 'nonsense' }).subgroup, 'none');
	assert.equal(normalizeQuery({ subgroup: 'prop:evil' }).subgroup, 'none');
	assert.equal(normalizeQuery({ subgroup: 42 }).subgroup, 'none');
	assert.equal(normalizeQuery({}).subgroup, 'none', 'a .base saved before this feature');
});

test('the second level counts as one toolbar setting', () => {
	assert.equal(activeQueryCount(q({ subgroup: 'status' })), 1);
	assert.equal(activeQueryCount(q({ group: 'note', subgroup: 'status' })), 2);
	assert.equal(activeQueryCount(q({ subgroup: 'none' })), 0);
});

test('tag as the first level: a task with two tags is split again under each of them', () => {
	const out = applyQuery(ROWS, q({ group: 'tag', subgroup: 'status' }), TODAY);
	assert.deepEqual(shape(out).filter(([label]) => label === '#work' || label === '#urgent'), [
		['#urgent', [['Done', 'done thing']]],
		['#work', [['To do', 'overdue'], ['Done', 'done thing']]],
	]);
});

test('a second level equal to the group neither applies nor counts', () => {
	assert.equal(activeQueryCount(q({ group: 'status', subgroup: 'status' })), 1, 'only the group');
	assert.equal(activeQueryCount(q({ group: 'note', subgroup: 'note' })), 1);
});
