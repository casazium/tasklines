// Generate a large vault for testing Tasklines inside Obsidian.
// Usage: node bench/make-perf-vault.mjs [dir] [notes]   (default: perf-vault 5000)
// Writes notes with frontmatter and ~2 tasks per note on average, a .base with a
// Tasklines view over all of them, and installs the current build of the plugin.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'perf-vault';
const NOTES = Number(process.argv[3] ?? 5000);
const OWNERS = ['Ana', 'Bob', 'Chen', 'Dee'];
const AREAS = ['work', 'home', 'health', 'learning'];
const PRIOS = ['⏫', '🔼', '🔽', '', ''];

if (existsSync(dir)) rmSync(dir, { recursive: true });
mkdirSync(join(dir, '.obsidian', 'plugins', 'tasklines'), { recursive: true });

let tasks = 0;
for (let i = 0; i < NOTES; i++) {
	const folder = join(dir, 'Notes', String(Math.floor(i / 500)).padStart(2, '0'));
	if (i % 500 === 0) mkdirSync(folder, { recursive: true });
	const lines = ['---', `owner: ${OWNERS[i % 4]}`, `area: ${AREAS[(i >> 2) % 4]}`, `size: ${i % 97}`, '---', `# Note ${i}`, '', 'Some prose about this project.', ''];
	// Two in five notes have no tasks; the rest have 1 to 6, some nested.
	if (i % 5 >= 2) {
		lines.push('## Tasks');
		const n = 1 + ((i * 7) % 6);
		for (let t = 0; t < n; t++) {
			const day = String(1 + ((i + t) % 28)).padStart(2, '0');
			const month = t % 2 ? '11' : '12';
			const status = (i + t) % 4 === 0 ? 'x' : ' ';
			const indent = t > 0 && t % 3 === 0 ? '\t' : '';
			const done = status === 'x' ? ' ✅ 2026-11-10' : '';
			lines.push(`${indent}- [${status}] Task ${t} of note ${i} #area/${t % 3} ${PRIOS[(i + t) % 5]} 📅 2026-${month}-${day}${done}`);
			tasks++;
		}
	}
	writeFileSync(join(folder, `Note ${i}.md`), lines.join('\n') + '\n');
}

writeFileSync(
	join(dir, 'All tasks.base'),
	[
		'views:',
		'  - type: tasklines',
		'    name: Open by area',
		'    order: [file.name, note.owner]',
		'    groupBy:',
		'      property: note.area',
		'      direction: ASC',
		'    taskQuery:',
		'      statuses: [todo, in-progress]',
		'      sort:',
		'        - key: due',
		'          desc: false',
		'  - type: tasklines',
		'    name: Everything, ungrouped',
		'    order: [file.name, note.owner, note.size]',
		'    taskQuery:',
		'      group: none',
		'',
	].join('\n'),
);
for (const f of ['main.js', 'manifest.json', 'styles.css']) cpSync(f, join(dir, '.obsidian', 'plugins', 'tasklines', f));
writeFileSync(join(dir, '.obsidian', 'community-plugins.json'), '["tasklines"]\n');
cpSync(join('test-vault', '.obsidian', 'core-plugins.json'), join(dir, '.obsidian', 'core-plugins.json'));
process.stdout.write(`${dir}: ${NOTES} notes, ${tasks} tasks\n`);
