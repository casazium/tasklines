import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agenda, byDay, CALENDAR_FIELDS, canClear, isRealDate, monthGrid, moveToDate, normalizeCalendarField, normalizeCalendarLayout, quickDates, shiftMonth, weekday } from '../src/calendar.ts';
import { applyEdit, type EditOptions } from '../src/edit.ts';
import type { IndexedTask } from '../src/extract.ts';
import { parseTaskLine } from '../src/parser.ts';
import type { QueryRow } from '../src/query.ts';

const TODAY = '2026-11-21'; // a Saturday
const OPTS: EditOptions = { today: TODAY, completionDate: 'auto', plainGetsEmojiDate: false, newFieldFormat: 'tasks-emoji' };
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/task-lines.json', import.meta.url), 'utf8')) as Array<{ name: string; line: string }>;

function task(line: string, n = 0): IndexedTask {
	const p = parseTaskLine(line);
	assert.ok(p, line);
	return { ...p, path: 'A.md', line: n, depth: 0, children: [] };
}
const row = (line: string, n = 0): QueryRow => ({ task: task(line, n), noteIndex: 0, noteName: 'A', baseGroup: '', baseGroupIndex: 0, props: new Map() });
const texts = (rows: QueryRow[]) => rows.map((r) => r.task.text);

test('settings fall back to due and to the given layout', () => {
	assert.equal(normalizeCalendarField('start'), 'start');
	assert.equal(normalizeCalendarField('done'), 'due', 'the done date is not something to reschedule');
	assert.equal(normalizeCalendarLayout('agenda', 'month'), 'agenda');
	assert.equal(normalizeCalendarLayout(undefined, 'agenda'), 'agenda');
});

test('dates: weekdays and months, across year ends', () => {
	assert.equal(weekday('2026-11-21'), 6);
	assert.equal(weekday('2026-11-01'), 0);
	assert.equal(shiftMonth('2026-12-01', 1), '2027-01-01');
	assert.equal(shiftMonth('2026-01-01', -1), '2025-12-01');
	assert.equal(shiftMonth('2026-11-01', -13), '2025-10-01');
});

test('month grid: whole weeks from the chosen first weekday', () => {
	const sunday = monthGrid('2026-11-01', 0);
	assert.equal(sunday[0]?.[0], '2026-11-01', 'November 2026 starts on a Sunday');
	assert.equal(sunday.length, 5);
	assert.equal(sunday.at(-1)?.at(-1), '2026-12-05');
	const monday = monthGrid('2026-11-01', 1);
	assert.equal(monday[0]?.[0], '2026-10-26');
	assert.equal(monday.length, 6);
	for (const week of [...sunday, ...monday]) assert.equal(week.length, 7);
	// February 2026 starts on a Sunday and has 28 days: exactly four weeks from Sunday.
	assert.equal(monthGrid('2026-02-01', 0).length, 4);
	// Every day of the month appears exactly once.
	const days = monday.flat().filter((d) => d.startsWith('2026-11'));
	assert.equal(days.length, 30);
	assert.equal(new Set(days).size, 30);
});

test('byDay keeps row order and sets undated tasks apart', () => {
	const { days, undated } = byDay([row('- [ ] a 📅 2026-11-21'), row('- [ ] b'), row('- [ ] c 📅 2026-11-21'), row('- [ ] d ⏳ 2026-11-22')], 'due');
	assert.deepEqual(texts(days.get('2026-11-21') ?? []), ['a', 'c']);
	assert.deepEqual(texts(undated), ['b', 'd']);
	assert.deepEqual(texts(byDay([row('- [ ] d ⏳ 2026-11-22')], 'scheduled').days.get('2026-11-22') ?? []), ['d']);
});

test('agenda: overdue (open only), today always, next days, later, no date', () => {
	const rows = [
		row('- [ ] late 📅 2026-11-01'),
		row('- [x] finished late 📅 2026-11-01 ✅ 2026-11-02'),
		row('- [ ] soon 📅 2026-11-23'),
		row('- [ ] edge 📅 2026-12-04'),
		row('- [ ] beyond 📅 2026-12-05'),
		row('- [ ] undated'),
	];
	const sections = agenda(rows, 'due', TODAY);
	assert.deepEqual(sections.map((s) => s.key), ['overdue', '2026-11-21', '2026-11-23', '2026-12-04', 'later', 'none']);
	assert.deepEqual(texts(sections[0]?.rows ?? []), ['late']);
	assert.equal(sections[1]?.rows.length, 0, 'today shows even when empty');
	assert.deepEqual(sections.map((s) => s.date), [null, '2026-11-21', '2026-11-23', '2026-12-04', null, null]);
	assert.deepEqual(texts(sections.at(-1)?.rows ?? []), ['undated']);
});

test('moveToDate: an edit only when the day changes', () => {
	const t = task('- [ ] a 📅 2026-11-21');
	assert.equal(moveToDate(t, 'due', '2026-11-21'), null);
	assert.deepEqual(moveToDate(t, 'due', '2026-11-22'), { kind: 'date', field: 'due', value: '2026-11-22' });
	assert.deepEqual(moveToDate(t, 'due', null), { kind: 'date', field: 'due', value: null });
	assert.equal(moveToDate(task('- [ ] b'), 'due', null), null);
	assert.equal(moveToDate(t, 'due', '21/11/2026'), null, 'only ISO dates');
	assert.deepEqual(moveToDate(t, 'start', '2026-11-25'), { kind: 'date', field: 'start', value: '2026-11-25' });
});

test('quick dates: no duplicates, nothing that changes nothing, relative to a future date', () => {
	const labels = (line: string) => quickDates(task(line), 'due', TODAY).map((c) => `${c.label}=${c.date}`);
	assert.deepEqual(labels('- [ ] a'), ['Today=2026-11-21', 'Tomorrow=2026-11-22', 'One week later=2026-11-28']);
	assert.deepEqual(labels('- [ ] a 📅 2026-11-21'), ['Tomorrow=2026-11-22', 'One week later=2026-11-28', 'Remove date=null']);
	assert.deepEqual(labels('- [ ] a 📅 2026-12-01'), ['Today=2026-11-21', 'Tomorrow=2026-11-22', 'One day later=2026-12-02', 'One week later=2026-12-08', 'Remove date=null']);
	assert.deepEqual(labels('- [ ] a 📅 2026-11-01'), ['Today=2026-11-21', 'Tomorrow=2026-11-22', 'One week later=2026-11-28', 'Remove date=null']);
});

// Every fixture, every date field, a move to a day and a clear: the edit either refuses or leaves
// the task on that day with its text unchanged.
for (const f of fixtures) {
	test(`calendar moves: ${f.name}`, () => {
		const t = task(f.line);
		for (const field of CALENDAR_FIELDS) {
			for (const date of ['2026-12-24', null]) {
				const edit = moveToDate(t, field, date);
				if (!edit) continue;
				let out: string;
				try {
					out = applyEdit(f.line, t, edit, OPTS);
				} catch {
					continue; // refused: nothing would be written
				}
				const after = task(out);
				assert.equal(after[field] ?? null, date, `${field} → ${date}: ${out}`);
				assert.equal(after.text.replace(/\s+/g, ' ').trim(), t.text.replace(/\s+/g, ' ').trim());
			}
		}
	});
}

test('dates that are not real days still show, in No date', () => {
	assert.equal(isRealDate('2026-11-31'), false);
	assert.equal(isRealDate('2026-13-45'), false);
	assert.equal(isRealDate('2028-02-29'), true);
	assert.equal(isRealDate('2026-02-29'), false);
	const rows = [row('- [ ] bad 📅 2026-11-31'), row('- [ ] worse 📅 2026-13-45'), row('- [ ] fine 📅 2026-11-30')];
	const { days, undated } = byDay(rows, 'due');
	assert.deepEqual(texts(undated), ['bad', 'worse']);
	assert.deepEqual([...days.keys()], ['2026-11-30']);
	const sections = agenda(rows, 'due', TODAY);
	assert.deepEqual(texts(sections.find((s) => s.key === 'none')?.rows ?? []), ['bad', 'worse']);
	const shown = sections.flatMap((s) => texts(s.rows));
	assert.deepEqual(shown.sort(), ['bad', 'fine', 'worse'], 'every task appears somewhere');
	// It can be moved to a real day; a move to a date that is not real is refused.
	assert.deepEqual(moveToDate(task('- [ ] bad 📅 2026-11-31'), 'due', '2026-12-01'), { kind: 'date', field: 'due', value: '2026-12-01' });
	assert.equal(moveToDate(task('- [ ] a'), 'due', '2026-02-30'), null);
});

test('a recurring task keeps its last date', () => {
	const only = task('- [ ] water 🔁 every week 📅 2026-11-21');
	assert.equal(canClear(only, 'due'), false);
	assert.equal(moveToDate(only, 'due', null), null);
	assert.ok(!quickDates(only, 'due', TODAY).some((c) => c.date === null), 'no Remove date choice');
	const two = task('- [ ] water 🔁 every week ⏳ 2026-11-20 📅 2026-11-21');
	assert.equal(canClear(two, 'due'), true, 'another date remains to repeat from');
	assert.deepEqual(moveToDate(two, 'due', null), { kind: 'date', field: 'due', value: null });
	assert.equal(canClear(task('- [ ] plain 📅 2026-11-21'), 'due'), true);
	assert.equal(canClear(task('- [ ] plain'), 'due'), false, 'nothing to remove');
});

test('agenda: the first days show even when empty, as drop targets', () => {
	const keys = agenda([row('- [ ] far 📅 2026-12-01')], 'due', TODAY, 7).map((s) => s.key);
	assert.deepEqual(keys, ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-12-01', 'none']);
	assert.deepEqual(agenda([], 'due', TODAY).map((s) => s.key), ['2026-11-21', 'none'], 'phones: today only');
});

test('month grid: leap-year February from Monday, and a month starting on the week start', () => {
	const feb = monthGrid('2028-02-01', 1);
	assert.equal(feb[0]?.[0], '2028-01-31');
	assert.equal(feb.flat().filter((d) => d.startsWith('2028-02')).length, 29);
	assert.equal(feb.at(-1)?.at(-1), '2028-03-05');
	assert.equal(monthGrid('2026-06-01', 1)[0]?.[0], '2026-06-01', 'June 2026 starts on a Monday');
	assert.equal(monthGrid('2026-11-01', 6)[0]?.[0], '2026-10-31', 'Saturday week start');
});
