import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_COLUMNS, type ColumnContext } from '../src/columns.ts';
import { extractTasks, type IndexedTask } from '../src/extract.ts';
import { applyQuery, daysBetween, DEFAULT_QUERY, formatSummary, normalizeQuery, summarize, type QueryRow } from '../src/query.ts';

const TODAY = '2026-11-20';
const item = (line: number, parent: number) => ({ task: ' ', parent, position: { start: { line } } });
const NOTE = ['- [ ] Parent 📅 2026-11-15 ➕ 2026-11-01', '\t- [x] Child A ✅ 2026-11-19', '\t- [ ] Child B 📅 2026-11-25', '- [-] Dropped ❌ 2026-10-01', '- [x] Old done ✅ 2026-09-01', '- [x] Undated done'].join('\n');
const TASKS = extractTasks('N.md', NOTE, [item(0, -0), item(1, 0), item(2, 0), item(3, -0), item(4, -0), item(5, -0)], []);
const byLine = new Map(TASKS.map((t) => [t.line, t]));
const CTX: ColumnContext = { today: TODAY, taskAt: (_p, l) => byLine.get(l), noteProgress: () => ({ done: 3, total: 5 }) };
const col = (key: string, t: IndexedTask) => TASK_COLUMNS.find((c) => c.key === key)?.value(t, CTX);
const rows = (): QueryRow[] => TASKS.map((task) => ({ task, noteIndex: 0, noteName: 'N', baseGroup: '', baseGroupIndex: 0, props: new Map() }));

test('direct children are linked to their parent', () => {
	assert.deepEqual(byLine.get(0)?.children, [1, 2]);
	assert.deepEqual(byLine.get(1)?.children, []);
});

test('computed columns', () => {
	const parent = byLine.get(0)!;
	assert.equal(col('overdue', parent), '5d');
	assert.equal(col('daysUntilDue', parent), '-5');
	assert.equal(col('daysUntilDue', byLine.get(2)!), '5');
	assert.equal(col('age', parent), '19');
	assert.equal(col('subtasks', parent), '1/2');
	assert.equal(col('subtasks', byLine.get(1)!), '');
	assert.equal(col('overdue', byLine.get(1)!), '', 'done tasks are never overdue');
	assert.equal(col('noteProgress', parent), '3/5 (60%)');
	assert.equal(col('status', parent), 'To do');
});

test('daysBetween across DST and year end', () => {
	assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
	assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
	assert.equal(daysBetween('2026-11-20', '2026-11-15'), -5);
});

test('completed-task window', () => {
	const show = (days: number | null) => applyQuery(rows(), { ...DEFAULT_QUERY, doneWithinDays: days, group: 'none' }, TODAY)[0]?.rows.map((r) => r.task.text);
	assert.deepEqual(show(null), ['Parent', 'Child A', 'Child B', 'Dropped', 'Old done', 'Undated done']);
	assert.deepEqual(show(7), ['Parent', 'Child A', 'Child B']);
	assert.deepEqual(show(0), ['Parent', 'Child B']);
	assert.deepEqual(show(60), ['Parent', 'Child A', 'Child B', 'Dropped']);
	assert.equal(normalizeQuery({ doneWithinDays: 7 }).doneWithinDays, 7);
	for (const bad of [-1, 2.5, '7', 99999]) assert.equal(normalizeQuery({ doneWithinDays: bad }).doneWithinDays, null);
});

test('summaries', () => {
	const s = summarize(rows(), TODAY);
	assert.deepEqual(s, { total: 6, open: 2, done: 3, cancelled: 1, overdue: 1 });
	assert.equal(formatSummary(s), '2 open · 1 overdue · 3 done (60%) · 1 cancelled');
	assert.equal(formatSummary(summarize([], TODAY)), '0 open');
});
