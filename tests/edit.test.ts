import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEdit, type EditOptions, type TaskEdit } from '../src/edit.ts';
import { parseTaskLine, type ParsedTask } from '../src/parser.ts';
import { editInContent, splitLines } from '../src/writeback.ts';

const OPTS: EditOptions = { today: '2026-11-20', completionDate: 'auto', plainGetsEmojiDate: false, newFieldFormat: 'tasks-emoji' };
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/task-lines.json', import.meta.url), 'utf8')) as Array<{ name: string; line: string }>;

function edit(line: string, e: TaskEdit, opts: Partial<EditOptions> = {}): string {
	const t = parseTaskLine(line);
	assert.ok(t);
	return applyEdit(line, t, e, { ...OPTS, ...opts });
}

// Fields an edit of `kind` may change; everything else must parse identically afterwards.
const ALLOWED: Record<string, Array<keyof ParsedTask>> = {
	due: ['due', 'fields', 'format'],
	scheduled: ['scheduled', 'fields', 'format'],
	priority: ['priority', 'fields', 'format'],
	status: ['status', 'done', 'cancelled', 'fields', 'format'],
};
const EDITS: Array<[string, TaskEdit, (t: ParsedTask) => void]> = [
	['due', { kind: 'date', field: 'due', value: '2030-01-02' }, (t) => assert.equal(t.due, '2030-01-02')],
	['due', { kind: 'date', field: 'due', value: null }, (t) => assert.equal(t.due, undefined)],
	['scheduled', { kind: 'date', field: 'scheduled', value: '2030-02-03' }, (t) => assert.equal(t.scheduled, '2030-02-03')],
	['priority', { kind: 'priority', value: 'lowest' }, (t) => assert.equal(t.priority, 'lowest')],
	['priority', { kind: 'priority', value: 'none' }, (t) => assert.equal(t.priority, 'none')],
	['status', { kind: 'status', value: '/' }, (t) => assert.equal(t.status, '/')],
];

for (const f of fixtures) {
	const before = parseTaskLine(f.line);
	if (!before) continue;
	for (const [kind, e, check] of EDITS) {
		test(`edit ${kind}=${JSON.stringify('value' in e ? e.value : '')}: ${f.name}`, () => {
			const doc = `# H\r\n${f.line}\r\ntail`;
			const r = editInContent(doc, { line: 1, raw: f.line }, e, OPTS);
			assert.ok(r.ok, r.ok ? '' : r.detail);
			const lines = splitLines(r.content);
			assert.deepEqual(lines[0], { text: '# H', eol: '\r\n' });
			assert.deepEqual(lines[2], { text: 'tail', eol: '' });
			assert.equal(lines[1]?.eol, '\r\n');
			const after = parseTaskLine(lines[1]?.text ?? '');
			assert.ok(after);
			check(after);
			for (const key of Object.keys(before) as Array<keyof ParsedTask>) {
				if (key === 'raw' || ALLOWED[kind]?.includes(key)) continue;
				assert.deepEqual(after[key], before[key], `${key} must not change`);
			}
		});
	}
}

test('dates: replace in place, keep the original emoji variant', () => {
	assert.equal(edit('- [ ] A 📆 2026-01-01 #x', { kind: 'date', field: 'due', value: '2026-02-02' }), '- [ ] A 📆 2026-02-02 #x');
	assert.equal(edit('- [ ] A [due:: 2026-01-01] (who:: me)', { kind: 'date', field: 'due', value: '2026-02-02' }), '- [ ] A [due:: 2026-02-02] (who:: me)');
	assert.equal(edit('- [ ] A (due:: 2026-01-01)', { kind: 'date', field: 'due', value: null }), '- [ ] A');
});

test('dates: added in the line’s own style, before a block id', () => {
	assert.equal(edit('- [ ] A ⏫', { kind: 'date', field: 'due', value: '2026-02-02' }), '- [ ] A ⏫ 📅 2026-02-02');
	assert.equal(edit('- [ ] A [owner:: me]', { kind: 'date', field: 'due', value: '2026-02-02' }), '- [ ] A [owner:: me] [due:: 2026-02-02]');
	assert.equal(edit('- [ ] A ^blk', { kind: 'date', field: 'start', value: '2026-02-02' }), '- [ ] A 🛫 2026-02-02 ^blk');
	assert.equal(edit('- [ ] Plain', { kind: 'date', field: 'due', value: '2026-02-02' }, { newFieldFormat: 'dataview' }), '- [ ] Plain [due:: 2026-02-02]');
});

test('dates in inline code are never edited', () => {
	assert.equal(edit('- [ ] A `📅 2026-01-01` 📅 2026-03-03', { kind: 'date', field: 'due', value: '2026-09-09' }), '- [ ] A `📅 2026-01-01` 📅 2026-09-09');
	assert.equal(edit('- [ ] A `📅 2026-01-01`', { kind: 'date', field: 'due', value: '2026-09-09' }), '- [ ] A `📅 2026-01-01` 📅 2026-09-09');
});

test('priority: swap emoji in place, Dataview field, remove', () => {
	assert.equal(edit('- [ ] A ⏫ 📅 2026-01-01', { kind: 'priority', value: 'low' }), '- [ ] A 🔽 📅 2026-01-01');
	assert.equal(edit('- [ ] A [priority:: high]', { kind: 'priority', value: 'medium' }), '- [ ] A [priority:: medium]');
	assert.equal(edit('- [ ] A 🔺 📅 2026-01-01', { kind: 'priority', value: 'none' }), '- [ ] A 📅 2026-01-01');
	assert.equal(edit('- [ ] A', { kind: 'priority', value: 'high' }), '- [ ] A ⏫');
});

test('status: done adds a completion date, leaving done removes it', () => {
	assert.equal(edit('- [/] A 📅 2026-01-01', { kind: 'status', value: 'x' }), '- [x] A 📅 2026-01-01 ✅ 2026-11-20');
	assert.equal(edit('- [x] A ✅ 2026-11-01', { kind: 'status', value: '/' }), '- [/] A');
	assert.equal(edit('- [ ] A', { kind: 'status', value: '?' }), '- [?] A');
	assert.equal(edit('- [x] A [completion:: 2026-11-01] [due:: 2026-01-01]', { kind: 'status', value: ' ' }), '- [ ] A [due:: 2026-01-01]');
});

test('invalid edits are refused, file unchanged', () => {
	const doc = '- [ ] A\n';
	for (const e of [{ kind: 'date', field: 'due', value: '31/12/2026' }, { kind: 'status', value: 'xx' }, { kind: 'status', value: ']' }] as TaskEdit[]) {
		const r = editInContent(doc, { line: 0, raw: '- [ ] A' }, e, OPTS);
		assert.equal(r.ok ? '' : r.reason, 'invalid-edit');
	}
	const stale = editInContent(doc, { line: 0, raw: '- [ ] B' }, { kind: 'priority', value: 'high' }, OPTS);
	assert.equal(stale.ok ? '' : stale.reason, 'line-changed');
});

test('a no-op edit reports changed: false', () => {
	const r = editInContent('- [ ] A ⏫', { line: 0, raw: '- [ ] A ⏫' }, { kind: 'priority', value: 'high' }, OPTS);
	assert.ok(r.ok && !r.changed);
});

test('status: cancelled dates follow the cancelled status, in the line’s style', () => {
	assert.equal(edit('- [ ] A 📅 2026-01-01', { kind: 'status', value: '-' }), '- [-] A 📅 2026-01-01 ❌ 2026-11-20');
	assert.equal(edit('- [ ] A [due:: 2026-01-01]', { kind: 'status', value: '-' }), '- [-] A [due:: 2026-01-01] [cancelled:: 2026-11-20]');
	assert.equal(edit('- [ ] Plain', { kind: 'status', value: '-' }), '- [-] Plain', 'plain lines get no date without Tasks');
	assert.equal(edit('- [ ] Plain', { kind: 'status', value: '-' }, { completionDate: 'off', plainGetsEmojiDate: true }), '- [-] Plain');
	assert.equal(edit('- [-] A ❌ 2026-11-01', { kind: 'status', value: ' ' }), '- [ ] A');
	assert.equal(edit('- [-] A ❌ 2026-11-01 📅 2026-01-01', { kind: 'status', value: 'x' }), '- [x] A 📅 2026-01-01 ✅ 2026-11-20', 'cancelled to done swaps the date');
	assert.equal(edit('- [-] A [cancelled:: 2026-11-01]', { kind: 'status', value: ' ' }), '- [ ] A');
	assert.equal(edit('- [x] A ✅ 2026-11-01', { kind: 'status', value: '-' }), '- [-] A ❌ 2026-11-20', 'done to cancelled swaps the date');
	assert.equal(edit('- [-] A `❌ 2026-11-01`', { kind: 'status', value: ' ' }), '- [ ] A `❌ 2026-11-01`', 'never inside inline code');
});
