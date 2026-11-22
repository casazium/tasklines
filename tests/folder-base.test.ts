// "Create a task base" for a folder: where the file goes and what it holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderBaseContent, folderBasePath } from '../src/folder-base.ts';
import { normalizeBoardField } from '../src/board.ts';
import { normalizeQuery } from '../src/query.ts';
import { parse } from 'yaml';

const none = () => false;

test('the base is named after the folder and goes inside it', () => {
	assert.equal(folderBasePath('Projects', none), 'Projects/Projects tasks.base');
	assert.equal(folderBasePath('Work/Client A', none), 'Work/Client A/Client A tasks.base');
	assert.equal(folderBasePath('Work/Client A/', none), 'Work/Client A/Client A tasks.base');
});

test('the vault root gets Tasks.base at the top', () => {
	assert.equal(folderBasePath('/', none), 'Tasks.base');
	assert.equal(folderBasePath('', none), 'Tasks.base');
});

test('never replaces a file: adds a number instead', () => {
	const taken = new Set(['Projects/Projects tasks.base', 'Projects/Projects tasks 2.base']);
	assert.equal(folderBasePath('Projects', (p) => taken.has(p)), 'Projects/Projects tasks 3.base');
	assert.equal(folderBasePath('/', (p) => p === 'Tasks.base'), 'Tasks 2.base');
});

test('the filter keeps to the folder, quoted safely', () => {
	const text = folderBaseContent('Work/"Odd" name');
	assert.ok(text.includes(`    - ${JSON.stringify('file.inFolder("Work/\\"Odd\\" name")')}`), text);
	assert.ok(!folderBaseContent('/').includes('filters:'), 'the whole vault has no folder filter');
});

test('it holds a list, a status board, an Eisenhower board and a calendar, with valid settings', () => {
	const text = folderBaseContent('Projects');
	const types = [...text.matchAll(/^ {2}- type: (\S+)$/gm)].map((m) => m[1]);
	assert.deepEqual(types, ['tasklines', 'tasklines-board', 'tasklines-board', 'tasklines-calendar']);
	const fields = [...text.matchAll(/boardField: (\S+)/g)].map((m) => m[1]);
	assert.deepEqual(fields.map((f) => normalizeBoardField(f)), ['status', 'eisenhower'], 'fields the board knows');
	assert.deepEqual(normalizeQuery({ statuses: ['todo', 'in-progress', 'other'] }).statuses, ['todo', 'in-progress', 'other']);
	assert.ok(text.endsWith('\n'));
	assert.ok(!/\t/.test(text), 'YAML is indented with spaces');
});

interface ParsedBase {
	filters?: { and: string[] };
	views: Array<{ type: string; name: string; boardField?: string; calendarField?: string; taskQuery?: Record<string, unknown> }>;
}
const parsed = (folder: string) => parse(folderBaseContent(folder)) as ParsedBase;

test('the file is valid YAML, and the filter survives awkward folder names exactly', () => {
	for (const dir of ['Projects', 'a: b', '#tag', 'x"y', "it's", 'a\\b', '- dash', '[x]', '{x}', '% y', '@x', 'Café & Co ü/日本語', 'Folder #1: "Q&A"', 'tab\there']) {
		const base = parsed(dir);
		assert.deepEqual(base.filters, { and: [`file.inFolder(${JSON.stringify(dir)})`] }, dir);
		assert.equal(base.views.length, 4, dir);
	}
});

test('the views, in full', () => {
	assert.deepEqual(
		parsed('Projects').views.map((v) => [v.type, v.name, v.boardField ?? v.calendarField ?? null]),
		[
			['tasklines', 'Open tasks', null],
			['tasklines-board', 'Board', 'status'],
			['tasklines-board', 'Urgent and important', 'eisenhower'],
			['tasklines-calendar', 'Calendar', 'due'],
		],
	);
	for (const v of parsed('Projects').views) {
		const q = normalizeQuery(v.taskQuery ?? {});
		if (v.taskQuery?.statuses) assert.deepEqual(q.statuses, ['todo', 'in-progress', 'other'], `${v.name}: only open tasks, so Finished stays empty`);
	}
	assert.equal(normalizeQuery(parsed('Projects').views[1]?.taskQuery ?? {}).doneWithinDays, 14);
});

test('the vault root: no filter, same four views', () => {
	const base = parsed('/');
	assert.equal(base.filters, undefined);
	assert.equal(base.views.length, 4);
});

test('a deep path is named after its last folder; spaces around a name are dropped from the file name only', () => {
	assert.equal(folderBasePath('a/b/c/', none), 'a/b/c/c tasks.base');
	assert.equal(folderBasePath('  sp  ', none), '  sp  /sp tasks.base');
});

test('a name taken in another case counts as taken (the command passes a case-blind check)', () => {
	const taken = new Set(['projects/projects tasks.base']);
	assert.equal(folderBasePath('Projects', (p) => taken.has(p.toLowerCase())), 'Projects/Projects tasks 2.base');
});
