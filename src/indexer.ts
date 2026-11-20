import type { App, TAbstractFile, TFile } from 'obsidian';
import { extractTasks, type IndexedTask } from './extract.ts';

export type { IndexedTask } from './extract.ts';

/** Passed to invalidation listeners to mean "everything changed". */
export const ALL_PATHS = '*';

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

	private app: App;
	private excluded: () => string[];

	/** `excluded` returns folder paths whose notes are never indexed (read on every query). */
	constructor(app: App, excluded: () => string[] = () => []) {
		this.app = app;
		this.excluded = excluded;
	}

	/** Tell every open view to re-render, e.g. after a settings change. */
	refreshAll(): void {
		for (const fn of this.listeners) fn([ALL_PATHS]);
	}

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

	/** Cached tasks for a file if still fresh, else undefined. Synchronous; never reads. */
	peek(file: TFile): IndexedTask[] | undefined {
		const cached = this.files.get(file.path);
		return cached && cached.mtime === file.stat.mtime ? cached.tasks : undefined;
	}

	/** Number of files currently cached (for tests and diagnostics). */
	get size(): number {
		return this.files.size;
	}

	async tasksFor(files: TFile[]): Promise<Map<string, IndexedTask[]>> {
		const t0 = performance.now();
		const stats: IndexStats = { filesSeen: files.length, filesSkippedNoTasks: 0, filesRead: 0, cacheHits: 0, ms: 0 };
		const out = new Map<string, IndexedTask[]>();

		const excluded = this.excluded();
		const isExcluded = (path: string) => excluded.some((f) => path === f || path.startsWith(`${f}/`));

		await Promise.all(
			files.map(async (file) => {
				if (file.extension !== 'md' || isExcluded(file.path)) return;
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
