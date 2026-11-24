import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDebugInfo, formatUtcOffset, type DebugFacts } from '../src/debug-info.ts';

const FACTS: DebugFacts = {
	tasklines: '1.5.0',
	obsidian: '1.15.1',
	platform: 'macOS desktop',
	language: 'en',
	utcOffset: -480,
	theme: 'Minimal',
	snippets: 1,
	basesEnabled: true,
	communityPlugins: 12,
	tasks: { version: '7.2.0', enabled: true },
	dataview: null,
	completionDate: 'auto',
	useTasksPlugin: true,
	newFieldFormat: 'tasks-emoji',
	customStatuses: false,
	excludedFolders: 2,
};

test('debug info lists versions and settings', () => {
	assert.equal(
		formatDebugInfo(FACTS),
		[
			'Tasklines: 1.5.0',
			'Obsidian: 1.15.1',
			'Platform: macOS desktop',
			'Language: en, UTC-08:00',
			'Theme: Minimal, 1 CSS snippet',
			'Bases: on',
			'Tasks plugin: 7.2.0 (on)',
			'Dataview: not installed',
			'Community plugins on: 12',
			'Settings: completion date auto, use Tasks yes, new fields tasks-emoji, custom statuses no, excluded folders 2',
		].join('\n'),
	);
});

test('debug info says when a plugin is installed but off', () => {
	assert.match(formatDebugInfo({ ...FACTS, tasks: { version: '7.0.0', enabled: false } }), /Tasks plugin: 7\.0\.0 \(off\)/);
});

test('debug info has counts only for private lists', () => {
	assert.deepEqual(Object.keys(FACTS).filter((k) => /path|note|file|folderName|vault/i.test(k)), []);
	assert.equal(typeof FACTS.excludedFolders, 'number');
	assert.equal(typeof FACTS.snippets, 'number');
});

test('UTC offsets, including half hours and zero', () => {
	assert.equal(formatUtcOffset(0), 'UTC+00:00');
	assert.equal(formatUtcOffset(330), 'UTC+05:30');
	assert.equal(formatUtcOffset(-210), 'UTC-03:30');
	assert.equal(formatUtcOffset(780), 'UTC+13:00');
});
