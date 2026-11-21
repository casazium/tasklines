import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describePlan, describeSummary, orderForWrite, planBulk, planStep, shiftRecords, summarize, type BulkAction, type UndoRecord } from '../src/bulk.ts';
import { applyEdit, type EditOptions } from '../src/edit.ts';
import type { IndexedTask } from '../src/extract.ts';
import { parseTaskLine, statusKind } from '../src/parser.ts';
import { editInContent, replaceLineInContent, toggleInContent, toggleTaskLine } from '../src/writeback.ts';

const TODAY = '2026-11-21';
const OPTS: EditOptions = { today: TODAY, completionDate: 'auto', plainGetsEmojiDate: false, newFieldFormat: 'tasks-emoji' };
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/task-lines.json', import.meta.url), 'utf8')) as Array<{ name: string; line: string }>;

function task(line: string, n = 0, path = 'A.md'): IndexedTask {
	const p = parseTaskLine(line);
	assert.ok(p, line);
	return { ...p, path, line: n, depth: 0, children: [] };
}
const kindOf = (a: ReturnType<typeof planStep>) => a.kind;

test('complete: open tasks only; recurring ones through the toggle; cancelled recurring refused', () => {
	assert.deepEqual(planStep(task('- [ ] a'), { kind: 'complete' }, TODAY), { kind: 'edit', edit: { kind: 'status', value: 'x' } });
	assert.deepEqual(planStep(task('- [/] a'), { kind: 'complete' }, TODAY), { kind: 'edit', edit: { kind: 'status', value: 'x' } });
	assert.equal(kindOf(planStep(task('- [ ] a 🔁 every day 📅 2026-11-21'), { kind: 'complete' }, TODAY)), 'toggle');
	assert.equal(kindOf(planStep(task('- [x] a'), { kind: 'complete' }, TODAY)), 'skip');
	assert.equal(kindOf(planStep(task('- [-] a'), { kind: 'complete' }, TODAY)), 'skip', 'Complete leaves cancelled tasks alone');
});

test('reopen: finished tasks back to to-do', () => {
	assert.deepEqual(planStep(task('- [x] a ✅ 2026-11-01'), { kind: 'reopen' }, TODAY), { kind: 'edit', edit: { kind: 'status', value: ' ' } });
	assert.deepEqual(planStep(task('- [-] a'), { kind: 'reopen' }, TODAY), { kind: 'edit', edit: { kind: 'status', value: ' ' } });
	assert.equal(kindOf(planStep(task('- [ ] a'), { kind: 'reopen' }, TODAY)), 'skip');
});

test('status: same rules as the board for done; a specific character otherwise', () => {
	assert.equal(kindOf(planStep(task('- [ ] a 🔁 every day 📅 2026-11-21'), { kind: 'status', char: 'x' }, TODAY)), 'toggle');
	assert.equal(kindOf(planStep(task('- [-] a 🔁 every day 📅 2026-11-21'), { kind: 'status', char: 'x' }, TODAY)), 'refuse');
	assert.deepEqual(planStep(task('- [ ] a'), { kind: 'status', char: '!' }, TODAY), { kind: 'edit', edit: { kind: 'status', value: '!' } }, 'a custom status of the same kind still changes');
	assert.equal(kindOf(planStep(task('- [/] a'), { kind: 'status', char: '/' }, TODAY)), 'skip');
});

test('dates: set, remove (a recurring task keeps its last date), shift from today once past', () => {
	const set: BulkAction = { kind: 'set-date', field: 'due', value: '2026-12-01' };
	assert.deepEqual(planStep(task('- [ ] a'), set, TODAY), { kind: 'edit', edit: { kind: 'date', field: 'due', value: '2026-12-01' } });
	assert.equal(kindOf(planStep(task('- [ ] a 📅 2026-12-01'), set, TODAY)), 'skip');
	const remove: BulkAction = { kind: 'set-date', field: 'due', value: null };
	assert.equal(kindOf(planStep(task('- [ ] a'), remove, TODAY)), 'skip');
	assert.equal(kindOf(planStep(task('- [ ] a 🔁 every week 📅 2026-11-20'), remove, TODAY)), 'refuse');
	assert.equal(kindOf(planStep(task('- [ ] a 🔁 every week ⏳ 2026-11-19 📅 2026-11-20'), remove, TODAY)), 'edit');
	const later: BulkAction = { kind: 'shift-date', field: 'due', days: 1 };
	assert.deepEqual(planStep(task('- [ ] a 📅 2026-12-01'), later, TODAY), { kind: 'edit', edit: { kind: 'date', field: 'due', value: '2026-12-02' } });
	assert.deepEqual(planStep(task('- [ ] a 📅 2026-11-01'), later, TODAY), { kind: 'edit', edit: { kind: 'date', field: 'due', value: '2026-11-22' } }, 'overdue: from today');
	assert.equal(kindOf(planStep(task('- [ ] a'), later, TODAY)), 'skip', 'no date to move');
	assert.equal(kindOf(planStep(task('- [ ] a 📅 2026-11-31'), later, TODAY)), 'skip', 'not a real date');
	assert.equal(kindOf(planStep(task('- [ ] a'), { kind: 'set-date', field: 'due', value: '2026-02-30' }, TODAY)), 'refuse');
	assert.deepEqual(planStep(task('- [ ] a'), { kind: 'set-date', field: 'scheduled', value: '2026-12-01' }, TODAY), { kind: 'edit', edit: { kind: 'date', field: 'scheduled', value: '2026-12-01' } });
});

test('priority', () => {
	assert.deepEqual(planStep(task('- [ ] a'), { kind: 'priority', value: 'high' }, TODAY), { kind: 'edit', edit: { kind: 'priority', value: 'high' } });
	assert.equal(kindOf(planStep(task('- [ ] a ⏫'), { kind: 'priority', value: 'high' }, TODAY)), 'skip');
});

test('write order: note by note, bottom line first', () => {
	const steps = [task('- [ ] a', 2, 'A.md'), task('- [ ] b', 9, 'B.md'), task('- [ ] c', 7, 'A.md'), task('- [ ] d', 1, 'B.md')].map((t) => ({ task: t }));
	assert.deepEqual(orderForWrite(steps).map((s) => `${s.task.path}:${s.task.line}`), ['A.md:7', 'A.md:2', 'B.md:9', 'B.md:1']);
});

test('undo records below an insertion move down', () => {
	const records: UndoRecord[] = [
		{ path: 'A.md', line: 9, written: 'x', original: 'y' },
		{ path: 'A.md', line: 2, written: 'x', original: 'y' },
		{ path: 'B.md', line: 9, written: 'x', original: 'y' },
	];
	shiftRecords(records, 'A.md', 5, 2);
	assert.deepEqual(records.map((r) => r.line), [10, 2, 9]);
	shiftRecords(records, 'A.md', 5, 1);
	assert.deepEqual(records.map((r) => r.line), [10, 2, 9], 'one line for one: nothing moves');
});

test('reports and confirmations', () => {
	const s = summarize([{ outcome: 'written' }, { outcome: 'written', toggle: true }, { outcome: 'skipped', reason: 'already finished' }, { outcome: 'skipped', reason: 'already finished' }, { outcome: 'refused', reason: 'line changed' }]);
	assert.deepEqual([s.written, s.skipped, s.refused, s.toggled], [2, 2, 1, 1]);
	assert.equal(describeSummary('Completed', 5, s), "Completed 2 of 5 tasks. 2 skipped: already finished. 1 refused: line changed. 1 recurring task completed through the Tasks plugin can't be undone here.");
	const plan = planBulk([task('- [ ] a', 0, 'A.md'), task('- [x] b', 1, 'A.md'), task('- [ ] c 🔁 every day 📅 2026-11-21', 0, 'B.md')], { kind: 'complete' }, TODAY);
	const d = describePlan('Complete', plan);
	assert.deepEqual([d.writes, d.notes, d.toggles], [2, 2, 1]);
	assert.match(d.text, /^Complete 2 tasks in 2 notes\? 1 selected task will be skipped or refused\. 1 recurring task/);
});

// A whole batch on one note, in memory, with the real write-back functions: a recurring task
// (completed by a stand-in Tasks plugin, which adds a line) between two plain ones. Written in the
// planned order, then undone: every edited line goes back, and only the recurring completion stays.
test('a batch with a recurring completion keeps every line number right, and undoes cleanly', () => {
	const lines = ['# Note', '- [ ] first 📅 2026-11-20', '- [ ] water 🔁 every week 📅 2026-11-20', 'prose', '- [ ] last 📅 2026-11-25', ''];
	let content = lines.join('\n');
	const tasks = [1, 2, 4].map((n) => task(lines[n] ?? '', n, 'N.md'));
	const plan = orderForWrite(planBulk(tasks, { kind: 'complete' }, TODAY));
	const fakeTasks = (line: string) => {
		const p = parseTaskLine(line);
		assert.ok(p);
		return `${line.replace('2026-11-20', '2026-11-27')}\n${toggleTaskLine(line, p, OPTS)}`;
	};
	const records: UndoRecord[] = [];
	for (const step of plan) {
		const ref = { line: step.task.line, raw: step.task.raw };
		if (step.op.kind === 'toggle') {
			const r = toggleInContent(content, ref, { ...OPTS, external: fakeTasks, expectDone: true });
			assert.ok(r.ok, r.ok ? '' : r.detail);
			content = r.content;
			shiftRecords(records, 'N.md', step.task.line, r.newLines.length);
		} else if (step.op.kind === 'edit') {
			const r = editInContent(content, ref, step.op.edit, OPTS);
			assert.ok(r.ok && r.changed, r.ok ? '' : r.detail);
			content = r.content;
			records.push({ path: 'N.md', line: step.task.line, written: r.newLine, original: step.task.raw });
		}
	}
	assert.deepEqual(content.split('\n'), [
		'# Note',
		'- [x] first 📅 2026-11-20 ✅ 2026-11-21',
		'- [ ] water 🔁 every week 📅 2026-11-27',
		'- [x] water 🔁 every week 📅 2026-11-20 ✅ 2026-11-21',
		'prose',
		'- [x] last 📅 2026-11-25 ✅ 2026-11-21',
		'',
	]);
	assert.deepEqual(records.map((r) => r.line).sort(), [1, 5], 'the record for "last" moved down with the insertion');
	for (const r of [...records].reverse()) {
		const u = replaceLineInContent(content, { line: r.line, raw: r.written }, r.original);
		assert.ok(u.ok, u.ok ? '' : u.detail);
		content = u.content;
	}
	assert.deepEqual(content.split('\n'), ['# Note', '- [ ] first 📅 2026-11-20', '- [ ] water 🔁 every week 📅 2026-11-27', '- [x] water 🔁 every week 📅 2026-11-20 ✅ 2026-11-21', 'prose', '- [ ] last 📅 2026-11-25', '']);
});

// Every fixture through every action: the planned edit either refuses or does what the action says.
const ACTIONS: BulkAction[] = [
	{ kind: 'complete' },
	{ kind: 'reopen' },
	{ kind: 'status', char: '/' },
	{ kind: 'priority', value: 'high' },
	{ kind: 'set-date', field: 'due', value: '2026-12-24' },
	{ kind: 'set-date', field: 'due', value: null },
	{ kind: 'shift-date', field: 'scheduled', days: 7 },
];
for (const f of fixtures) {
	test(`bulk actions: ${f.name}`, () => {
		const t = task(f.line);
		for (const action of ACTIONS) {
			const op = planStep(t, action, TODAY);
			if (op.kind !== 'edit') continue;
			let out: string;
			try {
				out = applyEdit(f.line, t, op.edit, OPTS);
			} catch {
				continue; // refused: nothing would be written
			}
			const after = task(out);
			const where = `${action.kind}: ${out}`;
			if (action.kind === 'complete') assert.equal(statusKind(after.status), 'done', where);
			if (action.kind === 'reopen') assert.equal(statusKind(after.status), 'todo', where);
			if (action.kind === 'status') assert.equal(after.status, action.char, where);
			if (action.kind === 'priority') assert.equal(after.priority, action.value, where);
			if (action.kind === 'set-date') assert.equal(after.due ?? null, action.value, where);
			if (action.kind === 'shift-date') assert.ok(after.scheduled && after.scheduled > TODAY, where);
			assert.equal(after.text.replace(/\s+/g, ' ').trim(), t.text.replace(/\s+/g, ' ').trim(), `${where}: text kept`);
		}
	});
}
