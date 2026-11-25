// Runs extraction against what Obsidian itself reported for the notes in
// test-vault/Cache samples/ (tests/fixtures/obsidian-cache.json), instead of the
// fake vault's guess. To recapture after changing a sample or upgrading Obsidian,
// see "Recapturing" in tests/fixtures/README.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractTasks } from '../src/extract.ts';
import { parseTaskLine } from '../src/parser.ts';
import { editInContent, splitLines, toggleInContent, type ToggleOptions } from '../src/writeback.ts';

interface Snapshot {
	capturedWith: string;
	files: Record<string, {
		content: string;
		listItems: Array<{ task?: string; parent: number; position: { start: { line: number } } }>;
		headings: Array<{ heading: string; level: number; position: { start: { line: number } } }>;
	}>;
}

const snapshot = JSON.parse(readFileSync(new URL('./fixtures/obsidian-cache.json', import.meta.url), 'utf8')) as Snapshot;

// Each task as "line:depth:parentLine:section", checked by hand against the notes.
const expected: Record<string, string[]> = {
	'blockquotes.md': ['0:0:-:-', '1:1:0:-', '3:0:-:-', '5:0:-:-', '6:0:-:-', '9:0:-:-'],
	'callouts.md': ['3:0:-:Callouts', '4:0:-:Callouts', '5:1:4:Callouts', '9:0:-:Callouts', '12:0:-:Callouts', '13:1:12:Callouts', '15:0:-:Callouts'],
	// Fenced (backtick, tilde, nested, indented) and indented code blocks hold no tasks.
	'code.md': ['16:0:-:Code', '20:0:-:Code', '26:0:-:Code'],
	'crlf.md': ['2:0:-:Windows line endings', '3:1:2:Windows line endings', '5:0:-:Windows line endings'],
	// Frontmatter, HTML comments, %% comments %% and HTML blocks hold no tasks.
	'frontmatter.md': ['6:0:-:-', '18:0:-:-'],
	// Setext headings count as sections; "#NotAHeading" is a tag, not a heading.
	'headings.md': ['3:0:-:Setext heading', '7:0:-:Second setext', '10:0:-:Second setext', '13:0:-:Heading with **bold** and [[link]]', '17:0:-:Heading with **bold** and [[link]]', '19:0:-:Heading with **bold** and [[link]]'],
	// Plain bullets between tasks add no depth. Obsidian does not list the eight-space
	// line or the space-then-tab line as list items, so they are not tasks.
	'indentation.md': ['2:0:-:Indentation', '3:1:2:Indentation', '4:2:3:Indentation', '5:2:3:Indentation', '6:1:2:Indentation', '9:0:-:Indentation', '11:1:9:Indentation', '12:0:-:Indentation', '14:1:12:Indentation'],
	// Blank lines between items do not end the list, so these subtasks keep their parent.
	'loose-lists.md': ['2:0:-:Loose list', '4:0:-:Loose list', '6:1:4:Loose list', '8:1:4:Loose list', '9:0:-:Loose list', '12:0:-:Loose list', '15:0:-:Loose list', '17:0:-:Loose list'],
	// "-[ ]", "- []", "- [ ]No space" and an empty "- [ ]" are not tasks.
	'markers.md': ['0:0:-:-', '5:0:-:-', '6:0:-:-', '7:0:-:-', '8:0:-:-', '9:0:-:-', '10:0:-:-', '11:0:-:-', '12:0:-:-'],
	'numbered.md': ['2:0:-:Numbered', '3:0:-:Numbered', '4:1:3:Numbered', '5:1:3:Numbered', '6:0:-:Numbered', '7:0:-:Numbered', '9:0:-:Numbered', '10:1:9:Numbered', '11:0:-:Numbered', '12:0:-:Numbered'],
};

test('the snapshot covers exactly the expected sample notes', () => {
	assert.deepEqual(Object.keys(snapshot.files).sort(), Object.keys(expected).sort());
});

for (const [name, file] of Object.entries(snapshot.files)) {
	test(`real Obsidian cache: ${name}`, () => {
		const tasks = extractTasks(name, file.content, file.listItems, file.headings);
		const got = tasks.map((t) => `${t.line}:${t.depth}:${t.parentLine ?? '-'}:${t.section ?? '-'}`);
		assert.deepEqual(got, expected[name]);

		// Every item Obsidian marks as a task is extracted, and nothing else is.
		const cacheTasks = file.listItems.filter((i) => i.task !== undefined).map((i) => i.position.start.line);
		assert.deepEqual(tasks.map((t) => t.line), cacheTasks);

		// Children point back at their parent.
		for (const t of tasks) for (const c of t.children) assert.equal(tasks.find((x) => x.line === c)?.parentLine, t.line);
	});
}

// Write-back inside the real notes: each task is ticked, unticked and given a due date where
// it sits, and nothing else in the note may change.
const OPTS: ToggleOptions = { today: '2026-11-25', completionDate: 'auto', plainGetsEmojiDate: true, newFieldFormat: 'tasks-emoji' };

function assertOnlyLineChanged(before: string, after: string, line: number, label: string): void {
	const a = splitLines(before);
	const b = splitLines(after);
	assert.equal(b.length, a.length, `${label}: line count unchanged`);
	a.forEach((was, i) => {
		if (i === line) {
			assert.equal(b[i]?.eol, was.eol, `${label}: line ending kept`);
			const p = parseTaskLine(b[i]?.text ?? '');
			const q = parseTaskLine(was.text);
			assert.ok(p && q, `${label}: still a task`);
			assert.equal(p.indent + p.marker, q.indent + q.marker, `${label}: indent and marker kept`);
		} else {
			assert.deepEqual(b[i], was, `${label}: line ${i} untouched`);
		}
	});
}

for (const [name, file] of Object.entries(snapshot.files)) {
	test(`write-back in place: ${name}`, () => {
		const tasks = extractTasks(name, file.content, file.listItems, file.headings);
		const shape = (content: string) => extractTasks(name, content, file.listItems, file.headings).map((t) => `${t.line}:${t.depth}:${t.parentLine ?? '-'}`);
		for (const t of tasks) {
			const ref = { line: t.line, raw: t.raw };
			const label = `${name} line ${t.line}`;

			const ticked = toggleInContent(file.content, ref, OPTS);
			assert.ok(ticked.ok, `${label}: toggle refused (${ticked.ok ? '' : ticked.detail})`);
			assertOnlyLineChanged(file.content, ticked.content, t.line, `${label} toggle`);
			assert.deepEqual(shape(ticked.content), shape(file.content), `${label}: tasks and nesting unchanged after toggle`);

			if (t.status === ' ' && !t.recurrence) {
				const newRaw = splitLines(ticked.content)[t.line]?.text ?? '';
				const back = toggleInContent(ticked.content, { line: t.line, raw: newRaw }, OPTS);
				assert.ok(back.ok, `${label}: untoggle refused`);
				// Adding the ✅ date trims trailing spaces, so compare without them.
				assert.equal(back.content.split(/\r?\n/)[t.line]?.trimEnd(), t.raw.trimEnd(), `${label}: tick then untick restores the line`);
			}

			const dated = editInContent(file.content, ref, { kind: 'date', field: 'due', value: '2026-12-01' }, OPTS);
			assert.ok(dated.ok, `${label}: date edit refused (${dated.ok ? '' : dated.detail})`);
			assertOnlyLineChanged(file.content, dated.content, t.line, `${label} due date`);
			assert.equal(parseTaskLine(splitLines(dated.content)[t.line]?.text ?? '')?.due, '2026-12-01', `${label}: due date set`);
		}
	});
}

test('Obsidian gives the root items of a list on line 0 a parent of -1, not 0', () => {
	const file = snapshot.files['markers.md'];
	assert.ok(file);
	assert.equal(file.listItems.find((i) => i.position.start.line === 0)?.parent, -1);
});
