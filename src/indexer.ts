import { App, ListItemCache, TAbstractFile, TFile } from 'obsidian';
import { parseTaskLine, ParsedTask } from './parser';

export interface IndexedTask extends ParsedTask {
	path: string;
	/** 0-based line number in the file. */
	line: number;
	/** Line of the parent list item if it is also a task, else undefined. */
	parentLine?: number;
	/** Nearest heading above the task. */
	section?: string;
}

interface FileEntry {
	mtime: number;
	tasks: IndexedTask[];
}

export interface IndexStats {
	filesSeen: number;
	filesSkippedNoTasks: number;
	filesRead: number;
	cacheHits: number;
	ms: number;
}

/**
 * Per-file task cache keyed by path and mtime.
 * Uses the metadata cache to skip files without tasks and to find task lines,
 * then reads the file only to get the line text.
 */
export class TaskIndex {
	private files = new Map<string, FileEntry>();
	lastStats: IndexStats = { filesSeen: 0, filesSkippedNoTasks: 0, filesRead: 0, cacheHits: 0, ms: 0 };

	constructor(private app: App) {}

	invalidate(file: TAbstractFile, oldPath?: string): void {
		this.files.delete(file.path);
		if (oldPath) this.files.delete(oldPath);
	}

	async tasksFor(files: TFile[]): Promise<Map<string, IndexedTask[]>> {
		const t0 = performance.now();
		const stats: IndexStats = { filesSeen: files.length, filesSkippedNoTasks: 0, filesRead: 0, cacheHits: 0, ms: 0 };
		const out = new Map<string, IndexedTask[]>();

		await Promise.all(
			files.map(async (file) => {
				if (file.extension !== 'md') return;
				const cached = this.files.get(file.path);
				if (cached && cached.mtime === file.stat.mtime) {
					stats.cacheHits++;
					out.set(file.path, cached.tasks);
					return;
				}
				const meta = this.app.metadataCache.getFileCache(file);
				const taskItems = (meta?.listItems ?? []).filter((li) => li.task !== undefined);
				if (taskItems.length === 0) {
					stats.filesSkippedNoTasks++;
					this.files.set(file.path, { mtime: file.stat.mtime, tasks: [] });
					out.set(file.path, []);
					return;
				}
				stats.filesRead++;
				const content = await this.app.vault.cachedRead(file);
				const tasks = extractTasks(file.path, content, taskItems, meta?.headings ?? []);
				this.files.set(file.path, { mtime: file.stat.mtime, tasks });
				out.set(file.path, tasks);
			}),
		);

		stats.ms = performance.now() - t0;
		this.lastStats = stats;
		return out;
	}
}

function extractTasks(
	path: string,
	content: string,
	items: ListItemCache[],
	headings: Array<{ heading: string; position: { start: { line: number } } }>,
): IndexedTask[] {
	const lines = content.split('\n');
	const taskLines = new Set(items.map((i) => i.position.start.line));
	const tasks: IndexedTask[] = [];
	for (const item of items) {
		const lineNo = item.position.start.line;
		const raw = (lines[lineNo] ?? '').replace(/\r$/, '');
		const parsed = parseTaskLine(raw);
		// The cache said "task" but the line does not parse: skip rather than guess.
		if (!parsed) continue;
		let section: string | undefined;
		for (const h of headings) {
			if (h.position.start.line < lineNo) section = h.heading;
			else break;
		}
		tasks.push({
			...parsed,
			path,
			line: lineNo,
			parentLine: item.parent >= 0 && taskLines.has(item.parent) ? item.parent : undefined,
			section,
		});
	}
	return tasks;
}
