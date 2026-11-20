import type { App, TAbstractFile, TFile } from 'obsidian';
import { extractTasks, type IndexedTask } from './extract.ts';

export type { IndexedTask } from './extract.ts';

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
	private listeners = new Set<(paths: string[]) => void>();
	lastStats: IndexStats = { filesSeen: 0, filesSkippedNoTasks: 0, filesRead: 0, cacheHits: 0, ms: 0 };

	constructor(private app: App) {}

	/** Drop a file's cached tasks and tell open views which paths changed. */
	invalidate(file: TAbstractFile, oldPath?: string): void {
		const paths = oldPath ? [file.path, oldPath] : [file.path];
		for (const p of paths) this.files.delete(p);
		for (const fn of this.listeners) fn(paths);
	}

	/** Subscribe to invalidations. Returns an unsubscribe function. */
	onInvalidate(fn: (paths: string[]) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
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
				const items = meta?.listItems ?? [];
				if (!items.some((li) => li.task !== undefined)) {
					stats.filesSkippedNoTasks++;
					this.files.set(file.path, { mtime: file.stat.mtime, tasks: [] });
					out.set(file.path, []);
					return;
				}
				stats.filesRead++;
				const content = await this.app.vault.cachedRead(file);
				const tasks = extractTasks(file.path, content, items, meta?.headings ?? []);
				this.files.set(file.path, { mtime: file.stat.mtime, tasks });
				out.set(file.path, tasks);
			}),
		);

		stats.ms = performance.now() - t0;
		this.lastStats = stats;
		return out;
	}
}
