import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTasks } from '../src/extract.ts';
import { stableSort, localDate } from '../src/view.ts';

// Mimics the metadata cache: list items with line, task char and parent line.
// parent is the parent item's line, or -(first line of the list) for root items.
const item = (line: number, parent: number, task?: string) => ({ task, parent, position: { start: { line } } });
const heading = (line: number, text: string) => ({ heading: text, position: { start: { line } } });

const NOTE = [
	'---', //                                0
	'status: active', //                     1
	'---', //                                2
	'# Alpha', //                            3
	'## Launch', //                          4
	'- [ ] Parent task 📅 2026-11-25', //   5
	'\t- [x] Child task', //                 6
	'\t\t- plain bullet', //                 7
	'\t\t\t- [ ] Grandchild under bullet', // 8
	'## Later', //                           9
	'- [ ] Later task', //                   10
	'- plain root bullet', //                11
	'```', //                                12
	'- [ ] in code block', //                13
	'```', //                                14
].join('\r\n');

const ITEMS = [
	item(5, -5, ' '),
	item(6, 5, 'x'),
	item(7, 6),
	item(8, 7, ' '),
	item(10, -10, ' '),
	item(11, -10),
	// The real cache never lists line 13 (code block), so neither does this fake.
];
const HEADINGS = [heading(3, 'Alpha'), heading(4, 'Launch'), heading(9, 'Later')];

test('extracts only task list items, with CRLF stripped', () => {
	const tasks = extractTasks('Projects/Alpha.md', NOTE, ITEMS, HEADINGS);
	assert.deepEqual(tasks.map((t) => t.line), [5, 6, 8, 10]);
	assert.equal(tasks[0]?.raw, '- [ ] Parent task 📅 2026-11-25');
	assert.equal(tasks[0]?.due, '2026-11-25');
});

test('section is the nearest heading above', () => {
	const tasks = extractTasks('a.md', NOTE, ITEMS, HEADINGS);
	assert.deepEqual(tasks.map((t) => t.section), ['Launch', 'Launch', 'Launch', 'Later']);
});

test('depth and parent skip plain bullets between tasks', () => {
	const [parent, child, grandchild, later] = extractTasks('a.md', NOTE, ITEMS, HEADINGS);
	assert.equal(parent?.depth, 0);
	assert.equal(parent?.parentLine, undefined);
	assert.equal(child?.depth, 1);
	assert.equal(child?.parentLine, 5);
	assert.equal(grandchild?.depth, 2);
	assert.equal(grandchild?.parentLine, 6, 'nearest task ancestor (line 6), skipping the plain bullet on line 7');
	assert.equal(later?.depth, 0);
});

test('cache says task but line does not parse: skipped, not guessed', () => {
	const tasks = extractTasks('a.md', 'not a task line', [item(0, -0, ' ')], []);
	assert.equal(tasks.length, 0);
});

test('stale cache line beyond end of file is skipped', () => {
	assert.equal(extractTasks('a.md', '- [ ] one', [item(5, -5, ' ')], []).length, 0);
});

test('task sort is stable and puts undated last', () => {
	const rows = [
		{ id: 'a', task: { due: undefined } },
		{ id: 'b', task: { due: '2026-02-01' } },
		{ id: 'c', task: { due: '2026-01-01' } },
		{ id: 'd', task: { due: '2026-01-01' } },
	] as unknown as Array<{ id: string; task: import('../src/extract.ts').IndexedTask }>;
	assert.deepEqual(stableSort(rows, 'due').map((r) => r.id), ['c', 'd', 'b', 'a']);
	assert.deepEqual(stableSort(rows, 'file').map((r) => r.id), ['a', 'b', 'c', 'd']);
});

test('localDate uses local time, not UTC', () => {
	assert.equal(localDate(new Date(2026, 0, 2, 23, 59)), '2026-01-02');
});
