import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDataviewBlock, migrationToBase, translateDataviewTask } from '../src/dataview-migrate.ts';
import { normalizeQuery } from '../src/query.ts';

test('a typical open-tasks query', () => {
	const m = translateDataviewTask(`TASK
FROM "Projects" AND #work AND -"Projects/Archive"
WHERE !completed AND due <= date(today) + dur(7 days) AND contains(text, "review")
SORT due ASC, priority DESC
GROUP BY file.link
LIMIT 20`);
	assert.deepEqual(m.filters, ['file.inFolder("Projects")', 'file.hasTag("work")', '!file.inFolder("Projects/Archive")']);
	assert.deepEqual(m.query.statuses, ['todo', 'in-progress', 'other']);
	assert.equal(m.query.due, 'next7');
	assert.equal(m.query.text, 'review');
	assert.deepEqual(m.query.sort, [{ key: 'due', desc: false }, { key: 'priority', desc: true }]);
	assert.equal(m.query.group, 'note');
	assert.equal(m.warnings.length, 2, m.warnings.join('\n')); // next7 caveat + LIMIT
});

test('absolute date range, tags, status and note property', () => {
	const m = translateDataviewTask(`task from #home or #garden
where due >= date(2026-01-01) and due <= date(2026-03-31) and contains(tags, "urgent") and status = "/" and project = "Alpha"`);
	assert.deepEqual(m.filters, ['note.project == "Alpha"']);
	assert.deepEqual(m.anyFilters, ['file.hasTag("home")', 'file.hasTag("garden")']);
	assert.equal(m.query.due, 'range');
	assert.equal(m.query.dueFrom, '2026-01-01');
	assert.equal(m.query.dueTo, '2026-03-31');
	assert.deepEqual(m.query.tags, ['#urgent']);
	assert.deepEqual(m.query.statuses, ['in-progress']);
});

test('overdue, today and completed', () => {
	assert.equal(translateDataviewTask('TASK WHERE due < date(today)').query.due, 'overdue');
	assert.equal(translateDataviewTask('TASK\nWHERE due = date(today)').query.due, 'today');
	assert.deepEqual(translateDataviewTask('TASK\nWHERE completed').query.statuses, ['done']);
});

test('untranslatable parts become warnings, never silently dropped', () => {
	const m = translateDataviewTask(`TASK
FROM [[Some Note]]
WHERE completed OR due
FLATTEN x
SORT length(text)
GROUP BY customfield`);
	assert.equal(m.warnings.length, 5, m.warnings.join('\n'));
});

test('non-TASK queries are rejected', () => {
	assert.throws(() => translateDataviewTask('TABLE file.name FROM "x"'), /Only Dataview TASK/);
});

test('generated .base is readable back into the same query', () => {
	const src = 'TASK\nFROM "Projects"\nWHERE !completed AND contains(text, "a \\"quoted\\" word")\nSORT due DESC\nGROUP BY status\nLIMIT 5';
	const m = translateDataviewTask(src);
	const base = migrationToBase(m, 'Open tasks', src);
	assert.match(base, /^# Created by Tasklines/);
	assert.match(base, /# {3}- LIMIT 5/);
	assert.match(base, /- "file.inFolder\(\\"Projects\\"\)"/);
	// Pull the taskQuery block back out with a tiny YAML subset reader to check round-trip.
	const block = base.slice(base.indexOf('    taskQuery:'));
	const statuses = /statuses: \[(.*)\]/.exec(block)?.[1]?.split(', ');
	const text = JSON.parse(/text: (".*")/.exec(block)?.[1] ?? '""') as string;
	const back = normalizeQuery({ statuses, text, sort: [{ key: 'due', desc: true }], group: /group: (\S+)/.exec(block)?.[1] });
	assert.deepEqual(back.statuses, m.query.statuses);
	assert.equal(back.text, 'a "quoted" word');
	assert.equal(back.group, 'status');
});

test('AND inside a quoted string with escapes does not split the clause', () => {
	const m = translateDataviewTask('TASK\nWHERE contains(text, "say \\"cats AND dogs\\" now") AND !completed');
	assert.equal(m.query.text, 'say "cats AND dogs" now');
	assert.deepEqual(m.query.statuses, ['todo', 'in-progress', 'other']);
	assert.deepEqual(m.warnings, []);
});

test('findDataviewBlock locates the fenced block under the cursor only', () => {
	const lines = ['# x', '```dataview', 'TASK', 'WHERE !completed', '```', 'text', '```js', 'code', '```', '~~~dataview', 'TASK', '~~~'];
	assert.deepEqual(findDataviewBlock(lines, 3), { start: 1, end: 4, source: 'TASK\nWHERE !completed' });
	assert.equal(findDataviewBlock(lines, 5), null);
	assert.equal(findDataviewBlock(lines, 7), null, 'not a dataview block');
	assert.equal(findDataviewBlock(lines, 10)?.source, 'TASK');
});
