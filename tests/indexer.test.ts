import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskIndex } from '../src/indexer.ts';
import { FakeVault } from './fake-vault.ts';

function setup() {
	const v = new FakeVault();
	v.write('A.md', '# A\n- [ ] one\n- [x] two\n');
	v.write('B.md', 'no tasks here\n- plain bullet\n');
	v.write('C.md', '```\n- [ ] in code\n```\n- [ ] real\n');
	const index = new TaskIndex(v.app());
	return { v, index };
}

test('skips task-free files without reading them, then serves from cache', async () => {
	const { v, index } = setup();
	const first = await index.tasksFor(v.all());
	assert.deepEqual(first.get('A.md')?.map((t) => t.text), ['one', 'two']);
	assert.deepEqual(first.get('B.md'), []);
	assert.deepEqual(first.get('C.md')?.map((t) => t.text), ['real'], 'code-block checkbox excluded');
	assert.equal(v.reads, 2, 'B.md was never read');
	assert.equal(index.lastStats.filesSkippedNoTasks, 1);

	await index.tasksFor(v.all());
	assert.equal(v.reads, 2, 'second pass reads nothing');
	assert.equal(index.lastStats.cacheHits, 3);
});

test('edit: new mtime is re-read even without invalidate', async () => {
	const { v, index } = setup();
	await index.tasksFor(v.all());
	v.write('A.md', '# A\n- [x] one\n- [x] two\n- [ ] three\n');
	const out = await index.tasksFor(v.all());
	assert.deepEqual(out.get('A.md')?.map((t) => `${t.status}${t.text}`), ['xone', 'xtwo', ' three']);
});

test('invalidate notifies listeners with old and new paths', async () => {
	const { v, index } = setup();
	await index.tasksFor(v.all());
	const seen: string[][] = [];
	const off = index.onInvalidate((p) => seen.push(p));
	const f = v.rename('A.md', 'Archive/A.md');
	index.invalidate(f, 'A.md');
	off();
	index.invalidate(v.get('C.md'));
	assert.deepEqual(seen, [['Archive/A.md', 'A.md']], 'unsubscribed listener not called again');
});

test('rename: tasks report the new path; old entry dropped', async () => {
	const { v, index } = setup();
	await index.tasksFor(v.all());
	const sizeBefore = index.size;
	const f = v.rename('A.md', 'Archive/A.md');
	index.invalidate(f, 'A.md');
	const out = await index.tasksFor(v.all());
	assert.equal(out.has('A.md'), false);
	assert.deepEqual(out.get('Archive/A.md')?.map((t) => t.path), ['Archive/A.md', 'Archive/A.md']);
	assert.equal(index.size, sizeBefore, 'no orphaned cache entry for the old path');
});

test('delete: invalidated file is gone from cache and results', async () => {
	const { v, index } = setup();
	await index.tasksFor(v.all());
	const f = v.remove('C.md');
	index.invalidate(f);
	const out = await index.tasksFor(v.all());
	assert.equal(out.has('C.md'), false);
	assert.equal(index.size, 2);
});

test('peek returns fresh cache only', async () => {
	const { v, index } = setup();
	assert.equal(index.peek(v.get('A.md')), undefined, 'nothing cached yet');
	await index.tasksFor(v.all());
	assert.equal(index.peek(v.get('B.md'))?.length, 0);
	v.write('B.md', '- [ ] now has a task\n');
	assert.equal(index.peek(v.get('B.md')), undefined, 'stale after mtime change');
});
