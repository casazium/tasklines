// Turns test-vault/Cache samples/_snapshot.json (written by the console script in
// tests/fixtures/README.md) into tests/fixtures/obsidian-cache.json, then deletes it.
// Run with: node tests/fixtures/import-cache-snapshot.ts

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

interface Position { start: { line: number } }
interface RawFile {
	content: string;
	listItems: Array<{ task?: string; parent: number; position: Position }>;
	headings: Array<{ heading: string; level: number; position: Position }>;
}

const raw = new URL('../../test-vault/Cache samples/_snapshot.json', import.meta.url);
const out = new URL('./obsidian-cache.json', import.meta.url);

const snap = JSON.parse(readFileSync(raw, 'utf8')) as { obsidian: string; files: Record<string, RawFile> };
const lineOnly = (p: Position): Position => ({ start: { line: p.start.line } });
const files: Record<string, RawFile> = {};
for (const [name, f] of Object.entries(snap.files)) {
	files[name] = {
		content: f.content,
		listItems: f.listItems.map((i) => ({ ...(i.task !== undefined ? { task: i.task } : {}), parent: i.parent, position: lineOnly(i.position) })),
		headings: f.headings.map((h) => ({ heading: h.heading, level: h.level, position: lineOnly(h.position) })),
	};
}
writeFileSync(out, JSON.stringify({ capturedWith: `Obsidian ${snap.obsidian}`, files }, null, 1) + '\n');
unlinkSync(raw);
console.log(`Wrote ${Object.keys(files).length} notes to tests/fixtures/obsidian-cache.json`);
