import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTaskLine } from '../src/parser.ts';
import { toggleInContent, splitLines, type ToggleOptions } from '../src/writeback.ts';

const OPTS: ToggleOptions = { today: '2026-11-20', completionDate: 'auto', plainGetsEmojiDate: false };
const fixtures = (JSON.parse(readFileSync(new URL('./fixtures/task-lines.json', import.meta.url), 'utf8')) as Array<{ name: string; line: string }>);

function toggle(line: string, opts: Partial<ToggleOptions> = {}): string {
	const r = toggleInContent(line, { line: 0, raw: line }, { ...OPTS, ...opts });
	assert.ok(r.ok, `toggle failed: ${r.ok ? '' : r.detail}`);
	return r.content;
}

// MVP acceptance check: no fixture toggle changes any character outside the target line.
const LAYOUTS: Array<[string, (l: string) => { doc: string; line: number }]> = [
	['LF, middle', (l) => ({ doc: `---\nk: v\n---\n# H\n${l}\n- [ ] after\n`, line: 4 })],
	['CRLF, middle', (l) => ({ doc: `# H\r\n- plain\r\n${l}\r\nprose 📅 2026-01-01\r\n`, line: 2 })],
	['first line', (l) => ({ doc: `${l}\nnext\n`, line: 0 })],
	['last line, no final newline', (l) => ({ doc: `before\n\n${l}`, line: 2 })],
	['mixed endings', (l) => ({ doc: `a\r\nb\n${l}\r\nc\nd`, line: 2 })],
];

for (const f of fixtures) {
	if (!parseTaskLine(f.line)) continue;
	for (const [layout, make] of LAYOUTS) {
		test(`byte safety: ${f.name} (${layout})`, () => {
			const { doc, line } = make(f.line);
			const r = toggleInContent(doc, { line, raw: f.line }, { ...OPTS, plainGetsEmojiDate: true });
			if (!r.ok) {
				assert.equal(r.reason, 'recurring-needs-tasks', r.detail);
				return;
			}
			const before = splitLines(doc);
			const after = splitLines(r.content);
			assert.equal(after.length, before.length, 'line count unchanged');
			before.forEach((b, i) => {
				if (i === line) {
					assert.equal(after[i]?.eol, b.eol, 'target line ending kept');
					assert.notEqual(after[i]?.text, b.text, 'target line changed');
					const p = parseTaskLine(after[i]?.text ?? '');
					assert.ok(p, 'still a task');
					assert.equal(p.indent + p.marker, parseTaskLine(b.text)?.indent + (parseTaskLine(b.text)?.marker ?? ''), 'indent and marker kept');
				} else {
					assert.deepEqual(after[i], b, `line ${i} untouched`);
				}
			});
		});
	}
}

test('round trip: tick then untick restores the original line', () => {
	for (const f of fixtures) {
		const t = parseTaskLine(f.line);
		if (!t || t.status !== ' ' || t.recurrence || t.done) continue;
		for (const plain of [true, false]) {
			const once = toggle(f.line, { plainGetsEmojiDate: plain });
			const twice = toggle(once, { plainGetsEmojiDate: plain });
			// Adding a date trims trailing spaces first; with no date added the line is restored byte for byte.
			const expected = once.includes('2026-11-20') ? f.line.replace(/\s+$/, '') : f.line;
			assert.equal(twice, expected, `${f.name} (plainGetsEmojiDate=${plain})`);
		}
	}
});

test('Tasks emoji format gets ✅ date at the end, before a block id', () => {
	assert.equal(toggle('- [ ] Ship 📅 2026-11-25'), '- [x] Ship 📅 2026-11-25 ✅ 2026-11-20');
	assert.equal(toggle('- [ ] Ship 🔼 ^blk-1'), '- [x] Ship 🔼 ✅ 2026-11-20 ^blk-1');
});

test('Dataview format gets [completion:: date]', () => {
	assert.equal(toggle('- [ ] Draft [due:: 2026-12-01]'), '- [x] Draft [due:: 2026-12-01] [completion:: 2026-11-20]');
	assert.equal(toggle('- [x] Draft [completion:: 2026-11-19] [due:: 2026-12-01]'), '- [ ] Draft [due:: 2026-12-01]');
});

test('plain tasks get a date only when Tasks is installed; off means no date', () => {
	assert.equal(toggle('- [ ] Plain'), '- [x] Plain');
	assert.equal(toggle('- [ ] Plain', { plainGetsEmojiDate: true }), '- [x] Plain ✅ 2026-11-20');
	assert.equal(toggle('- [ ] Ship 📅 2026-11-25', { completionDate: 'off' }), '- [x] Ship 📅 2026-11-25');
});

test('statuses: in-progress completes; done and cancelled reopen; existing done date kept', () => {
	assert.equal(toggle('- [/] Doing'), '- [x] Doing');
	assert.equal(toggle('- [-] Dropped'), '- [ ] Dropped');
	assert.equal(toggle('- [X] Shout ✅ 2026-01-01'), '- [ ] Shout');
	assert.equal(toggle('- [>] Forwarded ✅ 2026-01-01'), '- [x] Forwarded ✅ 2026-01-01');
});

test('un-ticking never touches a ✅ inside inline code', () => {
	assert.equal(toggle('- [x] Note `✅ 2026-01-01`'), '- [ ] Note `✅ 2026-01-01`');
});

test('refuses when the line changed, vanished or is not a task', () => {
	const doc = '# H\n- [ ] edited elsewhere\n';
	const changed = toggleInContent(doc, { line: 1, raw: '- [ ] original' }, OPTS);
	assert.equal(changed.ok ? '' : changed.reason, 'line-changed');
	const missing = toggleInContent(doc, { line: 9, raw: '- [ ] x' }, OPTS);
	assert.equal(missing.ok ? '' : missing.reason, 'line-missing');
	const notTask = toggleInContent('- [ ] a\nprose\n', { line: 1, raw: 'prose' }, OPTS);
	assert.equal(notTask.ok ? '' : notTask.reason, 'not-a-task');
});

test('recurring task: refused without Tasks, handled by Tasks when present', () => {
	const line = '- [ ] Water 🔁 every week 📅 2026-11-20';
	const doc = `a\n${line}\nb\n`;
	const alone = toggleInContent(doc, { line: 1, raw: line }, OPTS);
	assert.equal(alone.ok ? '' : alone.reason, 'recurring-needs-tasks');

	const external = (l: string) => `${l.replace('📅 2026-11-20', '📅 2026-11-27')}\n${l.replace('[ ]', '[x]')} ✅ 2026-11-20`;
	const r = toggleInContent(doc, { line: 1, raw: line }, { ...OPTS, external });
	assert.ok(r.ok);
	assert.equal(r.via, 'tasks-plugin');
	assert.equal(r.content, `a\n- [ ] Water 🔁 every week 📅 2026-11-27\n- [x] Water 🔁 every week 📅 2026-11-20 ✅ 2026-11-20\nb\n`);
	// Un-ticking a recurring task needs no Tasks plugin.
	assert.equal(toggle('- [x] Water 🔁 every week ✅ 2026-11-20'), '- [ ] Water 🔁 every week');
});

test('Tasks output: CRLF kept for both lines; unchanged output falls back; junk refused; dataview skips Tasks', () => {
	const line = '\t- [ ] Sub 🔁 every day';
	const two = (l: string) => `${l}\n${l.replace('[ ]', '[x]')}`;
	const r = toggleInContent(`x\r\n${line}\r\ny`, { line: 1, raw: line }, { ...OPTS, external: two });
	assert.ok(r.ok);
	assert.equal(r.content, `x\r\n${line}\r\n${line.replace('[ ]', '[x]')}\r\ny`);

	const same = toggleInContent('- [ ] Plain', { line: 0, raw: '- [ ] Plain' }, { ...OPTS, external: (l) => l });
	assert.ok(same.ok && same.via === 'built-in' && same.content === '- [x] Plain');

	for (const junk of ['', 'not a task', '- [x] a\n- [ ] b\n- [ ] c', '  - [x] wrong indent']) {
		const bad = toggleInContent('- [ ] Ship ⏫', { line: 0, raw: '- [ ] Ship ⏫' }, { ...OPTS, external: () => junk });
		assert.equal(bad.ok ? '' : bad.reason, 'bad-external-output', JSON.stringify(junk));
	}

	let called = false;
	toggleInContent('- [ ] D [due:: 2026-01-01]', { line: 0, raw: '- [ ] D [due:: 2026-01-01]' }, { ...OPTS, external: (l) => ((called = true), l) });
	assert.equal(called, false);
});
