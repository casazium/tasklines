import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_FIELDS, boardColumns, boardLayout, columnKey, isImportant, isUrgent, MATRIX_MIN_HEIGHT, MATRIX_MIN_WIDTH, MATRIX_SLACK, moveFor, normalizeBoardField, type BoardColumn } from '../src/board.ts';
import type { EditOptions } from '../src/edit.ts';
import type { IndexedTask } from '../src/extract.ts';
import { configureStatuses, DEFAULT_STATUSES, parseStatusSetting, parseTaskLine } from '../src/parser.ts';
import type { QueryRow } from '../src/query.ts';
import { editInContent, replaceLineInContent, splitLines, toggleInContent, toggleTaskLine } from '../src/writeback.ts';
import { fixtureLines } from './fixture-lines.ts';

const TODAY = '2026-11-20';
const OPTS: EditOptions = { today: TODAY, completionDate: 'auto', plainGetsEmojiDate: false, newFieldFormat: 'tasks-emoji' };
const fixtures = fixtureLines;

function task(line: string, n = 0): IndexedTask {
	const p = parseTaskLine(line);
	assert.ok(p, line);
	return { ...p, path: 'A.md', line: n, depth: 0, children: [] };
}
const row = (line: string, n = 0): QueryRow => ({ task: task(line, n), noteIndex: 0, noteName: 'A', baseGroup: '', baseGroupIndex: 0, props: new Map() });
const col = (columns: BoardColumn[], key: string) => {
	const c = columns.find((x) => x.key === key);
	assert.ok(c, `column ${key}`);
	return c;
};

test('board field falls back to status', () => {
	assert.equal(normalizeBoardField('priority'), 'priority');
	assert.equal(normalizeBoardField('bogus'), 'status');
	assert.equal(normalizeBoardField(undefined), 'status');
});

test('status columns keep row order and hide empty columns that take no drops', () => {
	const cols = boardColumns([row('- [ ] a', 0), row('- [x] b', 1), row('- [ ] c', 2), row('- [!] d', 3)], 'status', TODAY);
	assert.deepEqual(cols.map((c) => c.key), ['todo', 'in-progress', 'done', 'cancelled']);
	assert.deepEqual(col(cols, 'todo').rows.map((r) => r.task.text), ['a', 'c', 'd']);
	const withOther = boardColumns([row('- [?] q')], 'status', TODAY);
	assert.equal(col(withOther, 'other').target, null);
});

test('due buckets: finished tasks are never overdue', () => {
	const due = (line: string) => columnKey(task(line), 'due', TODAY);
	assert.equal(due('- [ ] a 📅 2026-11-19'), 'overdue');
	assert.equal(due('- [x] a 📅 2026-11-19'), 'past');
	assert.equal(due('- [-] a 📅 2026-11-19'), 'past');
	assert.equal(due('- [ ] a 📅 2026-11-20'), 'today');
	assert.equal(due('- [ ] a 📅 2026-11-21'), 'tomorrow');
	assert.equal(due('- [ ] a 📅 2026-11-27'), 'week');
	assert.equal(due('- [ ] a 📅 2026-11-28'), 'later');
	assert.equal(due('- [ ] a'), 'none');
});

test('moving to Done sets the done status directly, except for open recurring tasks', () => {
	const cols = boardColumns([], 'status', TODAY);
	const done = col(cols, 'done');
	assert.deepEqual(moveFor(task('- [ ] a'), done, TODAY), { kind: 'edit', edit: { kind: 'status', value: 'x' } });
	assert.deepEqual(moveFor(task('- [/] a'), done, TODAY), { kind: 'edit', edit: { kind: 'status', value: 'x' } });
	assert.deepEqual(moveFor(task('- [ ] a 🔁 every day 📅 2026-11-20'), done, TODAY), { kind: 'toggle' });
	assert.equal(moveFor(task('- [-] a 🔁 every day 📅 2026-11-20'), done, TODAY)?.kind, 'blocked');
	assert.equal(moveFor(task('- [X] a'), done, TODAY), null, 'already done');
	assert.equal(moveFor(task('- [!] a'), col(cols, 'todo'), TODAY), null, 'a custom to-do status stays');
	assert.deepEqual(moveFor(task('- [x] a'), col(cols, 'todo'), TODAY), { kind: 'edit', edit: { kind: 'status', value: ' ' } });
});

test('due targets are resolved on the day of the move', () => {
	const today = col(boardColumns([], 'due', TODAY), 'today');
	assert.deepEqual(moveFor(task('- [ ] a'), today, '2026-11-21'), { kind: 'edit', edit: { kind: 'date', field: 'due', value: '2026-11-21' } });
	assert.equal(moveFor(task('- [ ] a 📅 2026-11-21'), today, '2026-11-21'), null);
	const none = col(boardColumns([], 'due', TODAY), 'none');
	assert.deepEqual(moveFor(task('- [ ] a 📅 2026-11-21'), none, TODAY), { kind: 'edit', edit: { kind: 'date', field: 'due', value: null } });
});

// Every fixture, every field, every drop target, through the same functions the writer uses.
// A move either lands the task in the column it was dropped on (text unchanged), or is refused
// for a known reason. Refusals are collected and compared with an explicit list below, so a
// change that starts refusing (or stops refusing) moves cannot pass unnoticed.
const refused: string[] = [];
const blocked: string[] = [];
/** Stands in for the Tasks plugin: next occurrence (still open) above the completed line. */
const fakeTasks = (line: string) => {
	const p = parseTaskLine(line);
	assert.ok(p);
	return `${line}\n${toggleTaskLine(line, p, OPTS)}`;
};
// Lines the fixtures do not cover that matter for the board: competing fields (refused) and
// a cancelled recurring task (blocked from Done).
const BOARD_LINES = [
	{ name: 'board: two priorities', line: '- [ ] Two priorities ⏫ [priority:: low] 📅 2026-11-25' },
	{ name: 'board: due in both styles', line: '- [ ] Two dues 📅 2026-11-19 [due:: 2026-11-30]' },
	{ name: 'board: cancelled recurring', line: '- [-] Cancelled repeat 🔁 every week 📅 2026-11-19 ❌ 2026-11-18' },
	{ name: 'board: done recurring', line: '- [x] Done repeat 🔁 every week 📅 2026-11-19 ✅ 2026-11-18' },
	{ name: 'board: custom status', line: '- [!] Important 🔺 📅 2026-11-21' },
	{ name: 'board: dataview cancelled', line: '- [-] DV cancelled [due:: 2026-11-19] [cancelled:: 2026-11-18]' },
];
for (const f of [...fixtures, ...BOARD_LINES]) {
	test(`board moves: ${f.name}`, () => {
		const t = task(f.line);
		const doc = `# Head\r\n${f.line}\r\ntail`;
		const ref = { line: 1, raw: f.line };
		for (const field of BOARD_FIELDS) {
			for (const column of boardColumns([], field, TODAY).filter((c) => c.target)) {
				const where = `${f.name}: ${field} → ${column.key}`;
				const move = moveFor(t, column, TODAY);
				if (!move) {
					assert.equal(columnKey(t, field, TODAY), column.key, `${where}: no move only when already there`);
					continue;
				}
				if (move.kind === 'blocked') {
					if (field === 'eisenhower' && column.target?.field === 'eisenhower') {
						// Blocked exactly when the task is finished, the move would need two edits, or it would
						// remove a recurring task's due date.
						const finished = columnKey(t, field, TODAY) === 'finished';
						const diagonal = isUrgent(t, TODAY) !== column.target.urgent && isImportant(t) !== column.target.important;
						const repeatLosesDate = !!t.recurrence && isUrgent(t, TODAY) && !column.target.urgent;
						assert.ok(finished || diagonal || repeatLosesDate, `${where}: blocked without a reason`);
						continue;
					}
					blocked.push(where);
					continue;
				}
				if (move.kind === 'toggle') {
					assert.ok(t.recurrence, `${where}: only recurring tasks toggle`);
					const r = toggleInContent(doc, ref, { ...OPTS, external: fakeTasks, expectDone: true });
					assert.ok(r.ok, `${where}: ${r.ok ? '' : r.detail}`);
					assert.equal(r.newLines.length, 2, `${where}: next occurrence added`);
					assert.equal(columnKey(task(r.newLines[1] ?? ''), field, TODAY), column.key, `${where}: completed line is done`);
					const lines = splitLines(r.content);
					assert.deepEqual([lines[0], lines.at(-1)], [{ text: '# Head', eol: '\r\n' }, { text: 'tail', eol: '' }], `${where}: other lines untouched`);
					continue;
				}
				const r = editInContent(doc, ref, move.edit, OPTS);
				if (!r.ok) {
					assert.equal(r.reason, 'invalid-edit', `${where}: ${r.detail}`);
					refused.push(where);
					continue;
				}
				assert.ok(r.changed, `${where}: a move always changes the line`);
				const lines = splitLines(r.content);
				assert.equal(lines.length, 3, `${where}: one line in, one line out`);
				assert.deepEqual([lines[0], lines[2]], [{ text: '# Head', eol: '\r\n' }, { text: 'tail', eol: '' }], `${where}: other lines untouched`);
				const after = task(lines[1]?.text ?? '');
				assert.equal(columnKey(after, field, TODAY), column.key, `${where}: ${lines[1]?.text}`);
				assert.equal(after.text.replace(/\s+/g, ' ').trim(), t.text.replace(/\s+/g, ' ').trim(), `${where}: text kept`);
				assert.equal(after.indent + after.marker, t.indent + t.marker, `${where}: indent and marker kept`);
			}
		}
	});
}

test('board moves: refusals and blocked moves are exactly the expected ones', () => {
	assert.deepEqual(refused, EXPECTED_REFUSED);
	assert.deepEqual(blocked, EXPECTED_BLOCKED);
});

test('a toggle that must complete refuses when the Tasks plugin would not finish the task', () => {
	const line = '- [ ] a 🔁 every day 📅 2026-11-20';
	const toInProgress = () => '- [/] a 🔁 every day 📅 2026-11-20';
	const r = toggleInContent(line, { line: 0, raw: line }, { ...OPTS, external: toInProgress, expectDone: true });
	assert.equal(r.ok, false);
	assert.equal(!r.ok && r.reason, 'not-completed');
	const next = () => '- [ ] a 🔁 every day 📅 2026-11-21\n- [x] a 🔁 every day 📅 2026-11-20 ✅ 2026-11-20';
	assert.equal(toggleInContent(line, { line: 0, raw: line }, { ...OPTS, external: next, expectDone: true }).ok, true);
});

test('undo puts the line back only if it is still what the move wrote', () => {
	const content = 'x\n- [x] a ✅ 2026-11-20\ny\n';
	const ok = replaceLineInContent(content, { line: 1, raw: '- [x] a ✅ 2026-11-20' }, '- [ ] a');
	assert.ok(ok.ok);
	assert.equal(ok.ok && ok.content, 'x\n- [ ] a\ny\n');
	assert.equal(replaceLineInContent(content, { line: 1, raw: '- [x] a' }, '- [ ] a').ok, false, 'line changed since');
	assert.equal(replaceLineInContent(content, { line: 1, raw: '- [x] a ✅ 2026-11-20' }, '  - [ ] a').ok, false, 'different indent');
	assert.equal(replaceLineInContent(content, { line: 1, raw: '- [x] a ✅ 2026-11-20' }, '- [ ] a\n- [ ] b').ok, false, 'one line only');
	assert.equal(replaceLineInContent(content, { line: 1, raw: '- [x] a ✅ 2026-11-20' }, 'plain text').ok, false, 'must stay a task');
});

// Lines with repeated or competing fields, where a move could not read back as asked.
const EXPECTED_REFUSED: string[] = [
	'board: two priorities: priority → highest',
	'board: two priorities: priority → medium',
	'board: two priorities: priority → none',
	'board: two priorities: priority → low',
	'board: two priorities: priority → lowest',
	'board: two priorities: eisenhower → later',
];
// A cancelled recurring task cannot be completed without reopening it first.
const EXPECTED_BLOCKED: string[] = ['board: cancelled recurring: status → done'];

// Status settings: columns follow the configured statuses.
afterEach(() => configureStatuses(DEFAULT_STATUSES));
const useStatuses = (text: string) => {
	const { defs, errors } = parseStatusSetting(text);
	assert.deepEqual(errors, []);
	configureStatuses(defs);
};

test('status settings: no in-progress status means In progress takes no drops', () => {
	useStatuses(' | To do | todo\nx | Done | done\n- | Cancelled | cancelled');
	const cols = boardColumns([row('- [ ] a')], 'status', TODAY);
	assert.deepEqual(cols.map((c) => c.key), ['todo', 'done', 'cancelled'], 'empty locked columns are hidden');
	// A leftover [/] line now reads as an unknown status, which has no drop target.
	const withLeftover = boardColumns([row('- [/] a')], 'status', TODAY);
	assert.equal(col(withLeftover, 'other').target, null);
	assert.equal(col(withLeftover, 'other').rows.length, 1);
});

test('status settings: a custom in-progress character is used for moves', () => {
	useStatuses(' | To do | todo\n> | Doing | in-progress\nx | Done | done\n- | Cancelled | cancelled');
	const doing = col(boardColumns([], 'status', TODAY), 'in-progress');
	assert.deepEqual(moveFor(task('- [ ] a'), doing, TODAY), { kind: 'edit', edit: { kind: 'status', value: '>' } });
});

test('status settings: the core character wins when a kind has several', () => {
	useStatuses(' | To do | todo\n/ | Doing | in-progress\nd | Drafting | in-progress\nx | Done | done\n- | Cancelled | cancelled');
	const doing = col(boardColumns([], 'status', TODAY), 'in-progress');
	assert.deepEqual(moveFor(task('- [ ] a'), doing, TODAY), { kind: 'edit', edit: { kind: 'status', value: '/' } });
	assert.equal(moveFor(task('- [d] a'), doing, TODAY), null, 'another in-progress status is already there');
});

test('priority board: columns in priority order, all accept drops, even when empty', () => {
	const cols = boardColumns([row('- [ ] a 🔽'), row('- [ ] b ⏫'), row('- [ ] c')], 'priority', TODAY);
	assert.deepEqual(cols.map((c) => c.label), ['Highest', 'High', 'Medium', 'No priority', 'Low', 'Lowest']);
	assert.ok(cols.every((c) => c.target !== null));
	assert.deepEqual(cols.map((c) => c.rows.length), [0, 1, 0, 1, 1, 0]);
});

test('due board: range columns appear only when they have tasks', () => {
	assert.deepEqual(boardColumns([], 'due', TODAY).map((c) => c.key), ['today', 'tomorrow', 'none']);
	const cols = boardColumns([row('- [ ] a 📅 2026-11-01'), row('- [x] b 📅 2026-11-01'), row('- [ ] c 📅 2027-01-01')], 'due', TODAY);
	assert.deepEqual(cols.map((c) => c.key), ['overdue', 'today', 'tomorrow', 'later', 'none', 'past']);
	assert.ok(cols.filter((c) => ['overdue', 'later', 'past'].includes(c.key)).every((c) => c.target === null && c.note));
	for (const c of cols.filter((x) => x.target === null)) assert.equal(moveFor(task('- [ ] z'), c, TODAY), null, `${c.key} takes no drops`);
});

test('moves resolve dates on the day they happen, across a month end', () => {
	const tomorrow = col(boardColumns([], 'due', TODAY), 'tomorrow');
	assert.deepEqual(moveFor(task('- [ ] a'), tomorrow, '2026-12-31'), { kind: 'edit', edit: { kind: 'date', field: 'due', value: '2027-01-01' } });
});

// The Eisenhower board: urgent is overdue or due by tomorrow, important is high or highest priority.
const quadrant = (line: string, today = TODAY) => columnKey(task(line), 'eisenhower', today);

test('eisenhower: each task lands in the box its due date and priority say', () => {
	assert.equal(quadrant('- [ ] a ⏫ 📅 2026-11-20'), 'do');
	assert.equal(quadrant('- [ ] a 🔺 📅 2026-11-01'), 'do', 'overdue counts as urgent');
	assert.equal(quadrant('- [/] a ⏫ 📅 2026-11-21'), 'do', 'tomorrow is urgent; in progress is open');
	assert.equal(quadrant('- [ ] a ⏫ 📅 2026-11-22'), 'schedule', 'the day after tomorrow is not urgent');
	assert.equal(quadrant('- [ ] a 🔺'), 'schedule', 'no due date is not urgent');
	assert.equal(quadrant('- [ ] a 🔼 📅 2026-11-20'), 'delegate', 'medium is not important');
	assert.equal(quadrant('- [ ] a [due:: 2026-11-19]'), 'delegate', 'Dataview fields count');
	assert.equal(quadrant('- [ ] a [priority:: high] [due:: 2026-11-19]'), 'do');
	assert.equal(quadrant('- [ ] a 🔽 📅 2026-12-01'), 'later');
	assert.equal(quadrant('- [ ] a'), 'later');
	assert.equal(quadrant('- [x] a ⏫ 📅 2026-11-19'), 'finished');
	assert.equal(quadrant('- [-] a ⏫ 📅 2026-11-19'), 'finished');
	assert.equal(quadrant('- [!] a ⏫ 📅 2026-11-19'), 'do', 'a custom open status is open');
});

test('eisenhower: four boxes always shown, Finished only when it has tasks', () => {
	assert.deepEqual(boardColumns([], 'eisenhower', TODAY).map((c) => c.key), ['do', 'schedule', 'delegate', 'later']);
	const cols = boardColumns([row('- [x] a', 0), row('- [ ] b ⏫', 1)], 'eisenhower', TODAY);
	assert.deepEqual(cols.map((c) => [c.key, c.rows.length]), [['do', 0], ['schedule', 1], ['delegate', 0], ['later', 0], ['finished', 1]]);
	assert.equal(col(cols, 'finished').target, null);
	assert.ok(cols.every((c) => c.note), 'each box says what it means');
});

test('eisenhower: a move changes one field — due today or none, priority high or none', () => {
	const cols = boardColumns([], 'eisenhower', TODAY);
	assert.deepEqual(moveFor(task('- [ ] a ⏫'), col(cols, 'do'), TODAY), { kind: 'edit', edit: { kind: 'date', field: 'due', value: TODAY } });
	assert.deepEqual(moveFor(task('- [ ] a ⏫ 📅 2026-11-01'), col(cols, 'schedule'), TODAY), { kind: 'edit', edit: { kind: 'date', field: 'due', value: null } });
	assert.deepEqual(moveFor(task('- [ ] a 📅 2026-11-20'), col(cols, 'do'), TODAY), { kind: 'edit', edit: { kind: 'priority', value: 'high' } });
	assert.deepEqual(moveFor(task('- [ ] a 🔺 📅 2026-11-20'), col(cols, 'delegate'), TODAY), { kind: 'edit', edit: { kind: 'priority', value: 'none' } });
	assert.deepEqual(moveFor(task('- [ ] a 🔽'), col(cols, 'schedule'), TODAY), { kind: 'edit', edit: { kind: 'priority', value: 'high' } });
});

test('eisenhower: no move when already there, even if the exact fields differ', () => {
	const cols = boardColumns([], 'eisenhower', TODAY);
	assert.equal(moveFor(task('- [ ] a 🔺 📅 2026-11-21'), col(cols, 'do'), TODAY), null, 'highest and tomorrow are already urgent and important');
	assert.equal(moveFor(task('- [ ] a 🔽 📅 2026-12-25'), col(cols, 'later'), TODAY), null, 'a later date and low priority stay');
});

test('eisenhower: refuses diagonal moves and finished tasks, and says why', () => {
	const cols = boardColumns([], 'eisenhower', TODAY);
	const diag = moveFor(task('- [ ] a'), col(cols, 'do'), TODAY);
	assert.equal(diag?.kind, 'blocked');
	assert.match(diag?.kind === 'blocked' ? diag.reason : '', /Move it to Delegate or Schedule, then here\./);
	const back = moveFor(task('- [ ] a ⏫ 📅 2026-11-20'), col(cols, 'later'), TODAY);
	assert.match(back?.kind === 'blocked' ? back.reason : '', /Move it to Schedule or Delegate, then here\./);
	const done = moveFor(task('- [x] a ⏫'), col(cols, 'later'), TODAY);
	assert.equal(done?.kind, 'blocked');
	assert.match(done?.kind === 'blocked' ? done.reason : '', /Reopen/);
});

test('eisenhower: urgency follows the day of the move', () => {
	const cols = boardColumns([], 'eisenhower', TODAY);
	assert.equal(quadrant('- [ ] a ⏫ 📅 2026-11-22', '2026-11-21'), 'do');
	assert.deepEqual(moveFor(task('- [ ] a ⏫'), col(cols, 'do'), '2026-12-01'), { kind: 'edit', edit: { kind: 'date', field: 'due', value: '2026-12-01' } });
});

test('eisenhower: the refusal names both ways round, for every diagonal pair', () => {
	const cols = boardColumns([], 'eisenhower', TODAY);
	const cases: Array<[string, string, string]> = [
		['- [ ] a', 'do', 'Delegate or Schedule'],
		['- [ ] a ⏫ 📅 2026-11-20', 'later', 'Schedule or Delegate'],
		['- [ ] a ⏫', 'delegate', 'Do first or Later'],
		['- [ ] a 📅 2026-11-20', 'schedule', 'Later or Do first'],
	];
	for (const [line, to, via] of cases) {
		const m = moveFor(task(line), col(cols, to), TODAY);
		assert.equal(m?.kind, 'blocked', `${line} → ${to}`);
		const reason = m?.kind === 'blocked' ? m.reason : '';
		assert.ok(reason.includes(`Move it to ${via}, then here.`), reason);
		assert.ok(!/first first/.test(reason), reason);
	}
});

test('eisenhower: a recurring task keeps its due date', () => {
	const cols = boardColumns([], 'eisenhower', TODAY);
	for (const line of ['- [ ] Pay rent ⏫ 🔁 every month 📅 2026-11-19', '- [ ] Pay rent [priority:: high] [repeat:: every month] [due:: 2026-11-19]']) {
		const m = moveFor(task(line), col(cols, 'schedule'), TODAY);
		assert.equal(m?.kind, 'blocked', line);
		assert.match(m?.kind === 'blocked' ? m.reason : '', /recurring task needs its due date/);
	}
	// Other moves of a recurring task are fine: they keep a date.
	assert.deepEqual(moveFor(task('- [ ] r 🔁 every week 📅 2026-12-01'), col(cols, 'delegate'), TODAY), { kind: 'edit', edit: { kind: 'date', field: 'due', value: TODAY } });
	assert.deepEqual(moveFor(task('- [ ] r ⏫ 🔁 every week 📅 2026-11-20'), col(cols, 'delegate'), TODAY), { kind: 'edit', edit: { kind: 'priority', value: 'none' } });
});

test('eisenhower: the exact lines written, in each line\'s own format', () => {
	const cols = boardColumns([], 'eisenhower', TODAY);
	const write = (line: string, to: string) => {
		const m = moveFor(task(line), col(cols, to), TODAY);
		assert.equal(m?.kind, 'edit', `${line} → ${to}`);
		const r = editInContent(line, { line: 0, raw: line }, m?.kind === 'edit' ? m.edit : { kind: 'priority', value: 'none' }, OPTS);
		assert.ok(r.ok, `${line} → ${to}`);
		return r.ok ? r.content : '';
	};
	assert.equal(write('- [ ] a ⏫ 📅 2026-12-30', 'do'), '- [ ] a ⏫ 📅 2026-11-20', 'a later deadline becomes today');
	assert.equal(write('- [ ] a [priority:: high] [due:: 2026-12-30]', 'do'), '- [ ] a [priority:: high] [due:: 2026-11-20]');
	assert.equal(write('- [ ] a [priority:: high] [due:: 2026-11-20] tail', 'delegate'), '- [ ] a [due:: 2026-11-20] tail', 'the Dataview field goes, the text stays');
	assert.equal(write('- [ ] a 🔼 📅 2026-11-19', 'later'), '- [ ] a 🔼', 'not urgent removes the date; medium stays');
	assert.equal(write('- [ ] a 🔽', 'schedule'), '- [ ] a ⏫', 'low becomes high');
	assert.equal(write('- [ ] a `📅 2026-01-01` ⏫', 'do'), '- [ ] a `📅 2026-01-01` ⏫ 📅 2026-11-20', 'inline code untouched');
});

test('eisenhower: urgency across a month and year end, and only the due date counts', () => {
	assert.equal(quadrant('- [ ] a 📅 2027-01-01', '2026-12-31'), 'delegate');
	assert.equal(quadrant('- [ ] a 📅 2027-01-02', '2026-12-31'), 'later');
	assert.equal(quadrant('- [ ] a ⏫ ⏳ 2026-11-19'), 'schedule', 'a scheduled date is not a deadline');
	assert.equal(quadrant('- [ ] a ⏫ 🛫 2026-11-19'), 'schedule', 'nor is a start date');
	assert.equal(quadrant('- [ ] a [due:: 2026-11-21T10:00]'), 'delegate', 'a date with a time');
});

test('eisenhower: the field name round-trips and odd values fall back', () => {
	assert.equal(normalizeBoardField('eisenhower'), 'eisenhower');
	assert.equal(normalizeBoardField('Eisenhower'), 'status');
	assert.equal(normalizeBoardField('matrix'), 'status');
});

test('eisenhower: a custom finished status goes to Finished and cannot be moved', () => {
	useStatuses(' | To do | todo\nd | Delegated | done\nx | Done | done\n- | Cancelled | cancelled');
	assert.equal(quadrant('- [d] handed over ⏫ 📅 2026-11-20'), 'finished');
	assert.equal(moveFor(task('- [d] handed over ⏫ 📅 2026-11-20'), col(boardColumns([], 'eisenhower', TODAY), 'later'), TODAY)?.kind, 'blocked');
});

test('eisenhower layout: a 2×2 grid only when the board is wide and tall enough', () => {
	assert.equal(boardLayout('eisenhower', 1200, 800), 'matrix', 'a desktop pane');
	assert.equal(boardLayout('eisenhower', 1024, 1300), 'matrix', 'an iPad');
	assert.equal(boardLayout('eisenhower', 390, 700), 'columns', 'a phone');
	assert.equal(boardLayout('eisenhower', 800, 220), 'columns', 'a phone held sideways');
	assert.equal(boardLayout('eisenhower', 560, 900), 'columns', 'a narrow split pane');
	assert.ok(MATRIX_MIN_WIDTH >= 2 * 272 + 12, 'two boxes at the column width fit side by side');
});

test('eisenhower layout: slack at the thresholds keeps the layout from flipping back and forth', () => {
	const W = MATRIX_MIN_WIDTH, H = MATRIX_MIN_HEIGHT, d = MATRIX_SLACK;
	// From columns: the grid needs the threshold plus the slack.
	assert.equal(boardLayout('eisenhower', W, 900, 'columns'), 'columns');
	assert.equal(boardLayout('eisenhower', W + d, 900, 'columns'), 'matrix');
	assert.equal(boardLayout('eisenhower', 900, H + d - 1, 'columns'), 'columns');
	// From the grid: it stays until the threshold minus the slack.
	assert.equal(boardLayout('eisenhower', W - d, 900, 'matrix'), 'matrix');
	assert.equal(boardLayout('eisenhower', W - d - 1, 900, 'matrix'), 'columns');
	assert.equal(boardLayout('eisenhower', 900, H - d, 'matrix'), 'matrix');
	assert.equal(boardLayout('eisenhower', 900, H - d - 1, 'matrix'), 'columns');
	// A scrollbar appearing (about 17 px on Windows) at the threshold doesn't flip it.
	assert.equal(boardLayout('eisenhower', W + d - 17 + 5, 900, 'matrix'), 'matrix');
});

test('eisenhower layout: a hidden tab (size 0) keeps whatever was shown', () => {
	assert.equal(boardLayout('eisenhower', 0, 0, 'matrix'), 'matrix');
	assert.equal(boardLayout('eisenhower', 0, 0, 'columns'), 'columns');
	assert.equal(boardLayout('eisenhower', 900, 0, 'matrix'), 'matrix');
	assert.equal(boardLayout('eisenhower', 0, 0), 'columns', 'never measured: columns');
});

test('eisenhower layout: other boards are always columns, however much room', () => {
	for (const field of ['status', 'priority', 'due'] as const) {
		assert.equal(boardLayout(field, 5000, 5000), 'columns', field);
		assert.equal(boardLayout(field, 5000, 5000, 'matrix'), 'columns', `${field}, even after an Eisenhower grid`);
	}
});

test('eisenhower layout: without finished tasks there are exactly the four boxes', () => {
	assert.deepEqual(boardColumns([row('- [ ] a', 0)], 'eisenhower', TODAY).map((c) => c.key), ['do', 'schedule', 'delegate', 'later']);
});

test('eisenhower layout: the boxes come in grid order — urgent left, important top — then Finished', () => {
	const keys = boardColumns([row('- [x] done', 0)], 'eisenhower', TODAY).map((c) => [c.key, c.target?.field === 'eisenhower' ? [c.target.urgent, c.target.important] : null]);
	assert.deepEqual(keys, [
		['do', [true, true]],
		['schedule', [false, true]],
		['delegate', [true, false]],
		['later', [false, false]],
		['finished', null],
	]);
});

test('eisenhower layout: embedded in a note, only width decides (its height follows its cards)', () => {
	assert.equal(boardLayout('eisenhower', 700, Infinity), 'matrix');
	assert.equal(boardLayout('eisenhower', 700, Infinity, 'matrix'), 'matrix');
	assert.equal(boardLayout('eisenhower', 500, Infinity, 'matrix'), 'columns');
});
