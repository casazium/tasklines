// Turns a file's text plus its metadata-cache list items into indexed tasks.
// Type-only Obsidian imports, so it runs under `node --test`.

import type { HeadingCache, ListItemCache } from 'obsidian';
import { parseTaskLine, type ParsedTask } from './parser.ts';

export interface IndexedTask extends ParsedTask {
	path: string;
	/** 0-based line number in the file. */
	line: number;
	/** Line of the parent list item if it is also a task, else undefined. */
	parentLine?: number;
	/** Nesting depth among tasks: 0 for top-level, 1 for a subtask, and so on. */
	depth: number;
	/** Nearest heading above the task. */
	section?: string;
}

type ListItemLike = Pick<ListItemCache, 'task' | 'parent'> & { position: { start: { line: number } } };
type HeadingLike = Pick<HeadingCache, 'heading'> & { position: { start: { line: number } } };

export function extractTasks(path: string, content: string, items: ListItemLike[], headings: HeadingLike[]): IndexedTask[] {
	const lines = content.split('\n');
	const taskItems = items.filter((i) => i.task !== undefined);
	const taskLines = new Set(taskItems.map((i) => i.position.start.line));
	const parentOf = new Map(items.map((i) => [i.position.start.line, i.parent]));
	const sortedHeadings = [...headings].sort((a, b) => a.position.start.line - b.position.start.line);

	const tasks: IndexedTask[] = [];
	for (const item of taskItems) {
		const lineNo = item.position.start.line;
		const raw = (lines[lineNo] ?? '').replace(/\r$/, '');
		const parsed = parseTaskLine(raw);
		// The cache said "task" but the line does not parse: skip rather than guess.
		if (!parsed) continue;

		let section: string | undefined;
		for (const h of sortedHeadings) {
			if (h.position.start.line < lineNo) section = h.heading;
			else break;
		}

		// Walk up through list parents; plain bullets between tasks do not count as depth.
		let depth = 0;
		let parentLine: number | undefined;
		let p = item.parent;
		while (p >= 0) {
			if (taskLines.has(p)) {
				parentLine ??= p;
				depth++;
			}
			const next = parentOf.get(p);
			if (next === undefined || next === p) break;
			p = next;
		}

		tasks.push({ ...parsed, path, line: lineNo, parentLine, depth, section });
	}
	return tasks;
}
