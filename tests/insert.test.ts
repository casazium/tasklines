import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EditOptions } from '../src/edit.ts';
import { buildTaskLine, insertTaskInContent } from '../src/writeback.ts';

const OPTS: EditOptions = { today: '2026-11-20', completionDate: 'auto', plainGetsEmojiDate: false, newFieldFormat: 'tasks-emoji' };

test('build: text, priority and due in the chosen style', () => {
	assert.equal(buildTaskLine({ text: 'Call Ana', due: '2026-12-01', priority: 'high' }, '', OPTS), '- [ ] Call Ana ⏫ 📅 2026-12-01');
	assert.equal(buildTaskLine({ text: 'Call Ana', due: '2026-12-01' }, '', OPTS, 'dataview'), '- [ ] Call Ana [due:: 2026-12-01]');
	assert.equal(buildTaskLine({ text: ' multi\nline ' }, '', OPTS), '- [ ] multi line');
	assert.throws(() => buildTaskLine({ text: '   ' }, '', OPTS));
});

test('insert after the last task keeps every other byte and follows its style', () => {
	const doc = '# H\r\n- [ ] one [due:: 2026-01-01]\r\n\r\nprose\r\n';
	const r = insertTaskInContent(doc, { line: 1, raw: '- [ ] one [due:: 2026-01-01]' }, { text: 'two', due: '2026-02-02' }, OPTS);
	assert.ok(r.ok);
	assert.equal(r.content, '# H\r\n- [ ] one [due:: 2026-01-01]\r\n- [ ] two [due:: 2026-02-02]\r\n\r\nprose\r\n');
	assert.equal(r.line, 2);
});

test('insert after a task on the last line without a final newline', () => {
	const r = insertTaskInContent('- [ ] one', { line: 0, raw: '- [ ] one' }, { text: 'two' }, OPTS);
	assert.ok(r.ok);
	assert.equal(r.content, '- [ ] one\n- [ ] two');
});

test('insert refuses if the anchor task changed', () => {
	const r = insertTaskInContent('- [ ] edited', { line: 0, raw: '- [ ] one' }, { text: 'two' }, OPTS);
	assert.equal(r.ok ? '' : r.reason, 'line-changed');
});

test('append to a note without tasks: blank line before, trailing newline kept', () => {
	const a = insertTaskInContent('---\nk: v\n---\nSome prose.\n', null, { text: 'first' }, OPTS);
	assert.ok(a.ok);
	assert.equal(a.content, '---\nk: v\n---\nSome prose.\n\n- [ ] first\n');
	assert.equal(a.line, 5);
	const b = insertTaskInContent('Some prose.', null, { text: 'first' }, OPTS);
	assert.ok(b.ok);
	assert.equal(b.content, 'Some prose.\n\n- [ ] first');
	const empty = insertTaskInContent('', null, { text: 'first' }, OPTS);
	assert.ok(empty.ok);
	assert.equal(empty.content, '- [ ] first');
});

test('append: no extra blank line if the file already ends with one, or ends in a task', () => {
	const a = insertTaskInContent('prose\n\n', null, { text: 'x' }, OPTS);
	assert.ok(a.ok);
	assert.equal(a.content, 'prose\n\n- [ ] x\n');
	assert.equal(a.line, 2);
	const b = insertTaskInContent('- [ ] a\r\n', null, { text: 'x' }, OPTS);
	assert.ok(b.ok);
	assert.equal(b.content, '- [ ] a\r\n- [ ] x\r\n');
});

test('insert skips the anchor task’s nested bullets and continuation lines', () => {
	const doc = '- [ ] last\n\t- detail bullet\n\t  more detail\n\nprose\n';
	const r = insertTaskInContent(doc, { line: 0, raw: '- [ ] last' }, { text: 'new' }, OPTS);
	assert.ok(r.ok);
	assert.equal(r.content, '- [ ] last\n\t- detail bullet\n\t  more detail\n- [ ] new\n\nprose\n');
	assert.equal(r.line, 3);
});

test('insert after a subtask goes to the top level, after the whole subtree', () => {
	const doc = '- [ ] parent\n\t- [ ] child\n\t\t- note\n';
	const r = insertTaskInContent(doc, { line: 1, raw: '\t- [ ] child' }, { text: 'new' }, OPTS);
	assert.ok(r.ok);
	assert.equal(r.content, '- [ ] parent\n\t- [ ] child\n\t\t- note\n- [ ] new\n');
});

test('insert inside a callout keeps the quote prefix', () => {
	const doc = '> [!todo]\n> - [ ] a\n\nafter\n';
	const r = insertTaskInContent(doc, { line: 1, raw: '> - [ ] a' }, { text: 'b' }, OPTS);
	assert.ok(r.ok);
	assert.equal(r.content, '> [!todo]\n> - [ ] a\n> - [ ] b\n\nafter\n');
});
