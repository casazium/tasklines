import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOARD_FIELDS, boardColumns, columnKey, moveFor, normalizeBoardField, type BoardColumn } from '../src/board.ts';
import { applyEdit, type EditOptions } from '../src/edit.ts';
import type { IndexedTask } from '../src/extract.ts';
import { parseTaskLine } from '../src/parser.ts';
import type { QueryRow } from '../src/query.ts';
import { replaceLineInContent, toggleInContent } from '../src/writeback.ts';

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

// Every fixture, every field, every drop target: the edit either refuses or leaves a task that
// belongs in the column it was dropped on, with its text unchanged.
for (const f of fixtures) {
	test(`board moves: ${f.name}`, () => {
		const t = task(f.line);
		for (const field of BOARD_FIELDS) {
			for (const column of boardColumns([], field, TODAY).filter((c) => c.target)) {
				const move = moveFor(t, column, TODAY);
				if (!move || move.kind === 'blocked') continue;
				if (move.kind === 'toggle') {
					const r = toggleInContent(f.line, { line: 0, raw: f.line }, { ...OPTS, expectDone: true });
					if (r.ok) assert.equal(columnKey(task(r.newLines.at(-1) ?? ''), field, TODAY), column.key);
					continue;
				}
				let out: string;
				try {
					out = applyEdit(f.line, t, move.edit, OPTS);
				} catch {
					continue; // refused: nothing would be written
				}
				const after = task(out);
				assert.equal(columnKey(after, field, TODAY), column.key, `${field} → ${column.key}: ${out}`);
				assert.equal(after.text.replace(/\s+/g, ' ').trim(), t.text.replace(/\s+/g, ' ').trim());
			}
		}
	});
}

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
