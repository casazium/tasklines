import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskLine, isTaskLine } from '../src/parser.ts';

test('plain task', () => {
	const t = parseTaskLine('- [ ] Buy milk')!;
	assert.equal(t.status, ' ');
	assert.equal(t.text, 'Buy milk');
	assert.equal(t.format, 'plain');
});

test('Tasks plugin emoji fields', () => {
	const t = parseTaskLine('  - [x] Ship release #work ⏫ 🔁 every week on Monday 🛫 2026-11-01 ⏳ 2026-11-10 📅 2026-11-20 ✅ 2026-11-19')!;
	assert.equal(t.indent, '  ');
	assert.equal(t.status, 'x');
	assert.equal(t.priority, 'high');
	assert.equal(t.recurrence, 'every week on Monday');
	assert.equal(t.start, '2026-11-01');
	assert.equal(t.scheduled, '2026-11-10');
	assert.equal(t.due, '2026-11-20');
	assert.equal(t.done, '2026-11-19');
	assert.deepEqual(t.tags, ['#work']);
	assert.equal(t.text, 'Ship release #work');
	assert.equal(t.format, 'tasks-emoji');
});

test('Dataview inline fields', () => {
	const t = parseTaskLine('* [/] Draft spec [due:: 2026-12-01] (owner:: Bob) [priority:: high]')!;
	assert.equal(t.status, '/');
	assert.equal(t.due, '2026-12-01');
	assert.equal(t.fields.owner, 'Bob');
	assert.equal(t.priority, 'high');
	assert.equal(t.text, 'Draft spec');
	assert.equal(t.format, 'dataview');
});

test('numbered list, blockquote and custom status', () => {
	assert.equal(parseTaskLine('1. [?] Question')!.status, '?');
	assert.equal(parseTaskLine('> - [ ] In a callout')!.text, 'In a callout');
});

test('non-tasks', () => {
	for (const l of ['- not a task', '[ ] no marker', '-[ ] no space', '- [] empty brackets', '```']) assert.equal(isTaskLine(l), false, l);
});

test('raw is preserved exactly', () => {
	const line = '\t- [ ] keep  double  spaces 📅 2026-01-02 ';
	assert.equal(parseTaskLine(line)!.raw, line);
});

test('parse throughput: 10,000 task lines', () => {
	const lines = Array.from({ length: 10000 }, (_, i) => `- [ ] Task ${i} #tag 🔼 📅 2026-11-${String((i % 28) + 1).padStart(2, '0')} [owner:: x]`);
	const t0 = performance.now();
	for (const l of lines) parseTaskLine(l);
	const ms = performance.now() - t0;
	console.log(`parsed 10k lines in ${ms.toFixed(1)} ms`);
	assert.ok(ms < 500);
});
