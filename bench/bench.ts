// Benchmark: index, filter, sort and group on a synthetic vault.
// Run: npm run bench   (NOTES=8000 npm run bench for a bigger vault)
// Measures the plugin's own work in Node. It does not measure Bases' query time,
// BasesEntry.getValue cost or DOM rendering, which need a real Obsidian.

import { TaskIndex } from '../src/indexer.ts';
import { applyQuery, DEFAULT_QUERY, type QueryRow } from '../src/query.ts';
import { FakeVault } from '../tests/fake-vault.ts';

// The few Node globals this script uses (the project has no Node type definitions).
declare const process: { env: Record<string, string | undefined>; stdout: { write(text: string): boolean } };
// Results go to standard output: this is a command-line script, not plugin code.
const print = (line: string) => process.stdout.write(`${line}\n`);

const NOTES = Number(process.env.NOTES ?? 5000);
const TODAY = '2026-11-20';
const PRIOS = ['⏫', '🔼', '🔽', '', ''];
const OWNERS = ['Ana', 'Bob', 'Chen', 'Dee'];

function note(i: number): string {
	// Two in five notes have no tasks; the rest have 1 to 6.
	const lines = ['---', `owner: ${OWNERS[i % 4]}`, `size: ${i % 97}`, '---', `# Note ${i}`, 'Some prose about the project.', ''];
	if (i % 5 < 2) return lines.join('\n');
	const n = 1 + ((i * 7) % 6);
	lines.push('## Tasks');
	for (let t = 0; t < n; t++) {
		const day = String(1 + ((i + t) % 28)).padStart(2, '0');
		const status = (i + t) % 4 === 0 ? 'x' : ' ';
		const indent = t > 0 && t % 3 === 0 ? '\t' : '';
		lines.push(`${indent}- [${status}] Task ${t} of note ${i} #area/${t % 3} ${PRIOS[(i + t) % 5]} 📅 2026-${t % 2 ? '11' : '12'}-${day} [owner:: ${OWNERS[t % 4]}]`);
	}
	return lines.join('\n');
}

function time<T>(fn: () => T): [T, number] {
	const t0 = performance.now();
	const out = fn();
	return [out, performance.now() - t0];
}
async function timeAsync<T>(fn: () => Promise<T>): Promise<[T, number]> {
	const t0 = performance.now();
	const out = await fn();
	return [out, performance.now() - t0];
}

const vault = new FakeVault();
for (let i = 0; i < NOTES; i++) vault.write(`Notes/N${i}.md`, note(i));
const files = vault.all();
const index = new TaskIndex(vault.app());

const [byPath, cold] = await timeAsync(() => index.tasksFor(files));
const coldStats = { ...index.lastStats };
const coldReads = vault.reads;
const [, warm] = await timeAsync(() => index.tasksFor(files));
const edited = vault.write('Notes/N7.md', note(7) + '\n- [ ] Added task 📅 2026-11-21');
index.invalidate(edited);
const [, oneEdit] = await timeAsync(() => index.tasksFor(files));

const rows: QueryRow[] = [];
files.forEach((f, noteIndex) => {
	const props = new Map([['note.owner', OWNERS[noteIndex % 4] ?? ''], ['note.size', String(noteIndex % 97)]]);
	for (const task of byPath.get(f.path) ?? []) rows.push({ task, noteIndex, noteName: f.basename, baseGroup: '', baseGroupIndex: 0, props });
});

const queries = {
	'no filter, base order': DEFAULT_QUERY,
	'open + due next 30, sort due then priority, group by due': {
		...DEFAULT_QUERY,
		statuses: ['todo' as const],
		due: 'next30' as const,
		sort: [{ key: 'due', desc: false }, { key: 'priority', desc: false }],
		group: 'due',
	},
	'text search, sort by note property, group by note property': {
		...DEFAULT_QUERY,
		text: 'task 3',
		sort: [{ key: 'prop:note.size', desc: true }],
		group: 'prop:note.owner',
	},
	'tag filter, group by tag': { ...DEFAULT_QUERY, tags: ['#area'], group: 'tag' },
};

const ms = (n: number) => `${n.toFixed(1)} ms`;
print(`Vault: ${NOTES} notes, ${rows.length} tasks, ${coldStats.filesSkippedNoTasks} notes without tasks (never read)`);
print(`Index cold:            ${ms(cold)}  (${coldReads} files read)`);
print(`Index warm (cached):   ${ms(warm)}`);
print(`Index after 1 edit:    ${ms(oneEdit)}`);
for (const [name, q] of Object.entries(queries)) {
	applyQuery(rows, q, TODAY); // warm-up
	const runs = 5;
	let total = 0;
	let shown = 0;
	for (let r = 0; r < runs; r++) {
		const [groups, t] = time(() => applyQuery(rows, q, TODAY));
		total += t;
		shown = groups.reduce((n, g) => n + g.rows.length, 0);
	}
	print(`Query: ${name.padEnd(62)} ${ms(total / runs).padStart(9)}  (${shown} rows)`);
}
