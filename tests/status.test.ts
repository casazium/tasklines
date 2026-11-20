import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { configureStatuses, DEFAULT_STATUSES, formatStatusSetting, parseStatusSetting, statusKind, statusName } from '../src/parser.ts';

afterEach(() => configureStatuses(DEFAULT_STATUSES));

test('defaults', () => {
	assert.equal(statusKind(' '), 'todo');
	assert.equal(statusKind('X'), 'done');
	assert.equal(statusKind('/'), 'in-progress');
	assert.equal(statusKind('~'), 'other');
	assert.equal(statusName('?'), 'Question');
	assert.equal(statusName('~'), '[~]');
});

test('setting round-trips, including the space status', () => {
	const text = formatStatusSetting(DEFAULT_STATUSES);
	const { defs, errors } = parseStatusSetting(text);
	assert.deepEqual(errors, []);
	assert.deepEqual(defs, DEFAULT_STATUSES);
});

test('custom statuses; core meanings cannot be overridden', () => {
	const { defs, errors } = parseStatusSetting('b | Blocked | in-progress\nx | Finished | todo\n# comment\n\nbad line\nab | Two | todo\nz | Zed | nope');
	assert.equal(errors.length, 3);
	configureStatuses(defs);
	assert.equal(statusKind('b'), 'in-progress');
	assert.equal(statusName('b'), 'Blocked');
	assert.equal(statusKind('x'), 'done', 'x stays done');
	assert.equal(statusName('x'), 'Finished', 'but can be renamed');
	assert.equal(statusKind(' '), 'todo', 'space still present');
	assert.equal(statusKind('/'), 'other', 'statuses not listed fall back to other');
});
