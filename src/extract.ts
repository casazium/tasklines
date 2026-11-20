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
	/** Lines of direct subtasks (tasks whose nearest task ancestor is this one). */
	children: number[];
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
		// A root item's parent is -(first line of the list), which is 0 for a list on line 0,
		// so "parent >= 0" alone is ambiguous. A real parent is always indented less.
		let depth = 0;
		let parentLine: number | undefined;
		let child = lineNo;
		let p = item.parent;
		while (p >= 0 && p !== child && parentOf.has(p) && indentWidth(lines[p] ?? '') < indentWidth(lines[child] ?? '')) {
			if (taskLines.has(p)) {
				parentLine ??= p;
				depth++;
			}
			child = p;
			p = parentOf.get(p) ?? -1;
		}

		tasks.push({ ...parsed, path, line: lineNo, parentLine, depth, section, children: [] });
	}
	const byLine = new Map(tasks.map((t) => [t.line, t]));
	for (const t of tasks) if (t.parentLine !== undefined) byLine.get(t.parentLine)?.children.push(t.line);
	return tasks;
}

/** Visual indent of a list line: tabs count as 4 columns; blockquote markers count too. */
function indentWidth(line: string): number {
	const lead = /^[\s>]*/.exec(line)?.[0] ?? '';
	let w = 0;
	for (const ch of lead) w += ch === '\t' ? 4 : 1;
	return w;
}
