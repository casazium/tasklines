import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOARD_FIELDS, boardColumns, columnKey, moveFor, normalizeBoardField, type BoardColumn } from '../src/board.ts';
import type { EditOptions } from '../src/edit.ts';
import type { IndexedTask } from '../src/extract.ts';
import { configureStatuses, DEFAULT_STATUSES, parseStatusSetting, parseTaskLine } from '../src/parser.ts';
import type { QueryRow } from '../src/query.ts';
import { editInContent, replaceLineInContent, splitLines, toggleInContent, toggleTaskLine } from '../src/writeback.ts';

const TODAY = '2026-11-20';
const OPTS: EditOptions = { today: TODAY, completionDate: 'auto', plainGetsEmojiDate: false, newFieldFormat: 'tasks-emoji' };
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/task-lines.json', import.meta.url), 'utf8')) as Array<{ name: string; line: string }>;

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
