// Task lines that every per-line suite (toggle, edit, board, calendar, bulk) runs on:
// the hand-written cases in fixtures/task-lines.json plus every task line from the
// sample notes Obsidian indexed (fixtures/obsidian-cache.json), such as tasks in
// callouts, blockquotes and numbered lists.

import { readFileSync } from 'node:fs';

export interface FixtureLine { name: string; line: string }

interface CacheSnapshot {
	files: Record<string, { content: string; listItems: Array<{ task?: string; position: { start: { line: number } } }> }>;
}

const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));

/** Task lines from the sample notes, as Obsidian marked them, without line endings. */
export function sampleNoteLines(): FixtureLine[] {
	const snapshot = read('obsidian-cache.json') as CacheSnapshot;
	const out: FixtureLine[] = [];
	for (const [name, file] of Object.entries(snapshot.files)) {
		const lines = file.content.split(/\r?\n/);
		for (const item of file.listItems) {
			if (item.task === undefined) continue;
			const n = item.position.start.line;
			out.push({ name: `sample ${name} line ${n}`, line: lines[n] ?? '' });
		}
	}
	return out;
}

export const fixtureLines: FixtureLine[] = [...(read('task-lines.json') as FixtureLine[]), ...sampleNoteLines()];
