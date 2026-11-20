import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTaskLine } from '../src/parser.ts';

interface Fixture { name: string; line: string; expect: Record<string, unknown> }
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/task-lines.json', import.meta.url), 'utf8')) as Fixture[];

for (const f of fixtures) {
	test(`fixture: ${f.name}`, () => {
		const t = parseTaskLine(f.line);
		assert.ok(t, 'line should parse as a task');
		assert.equal(t.raw, f.line, 'raw must be the exact input line');
		for (const [key, want] of Object.entries(f.expect)) {
			assert.deepEqual((t as unknown as Record<string, unknown>)[key], want, `${key} in ${JSON.stringify(f.line)}`);
		}
	});
}
