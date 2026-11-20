import { Notice, Plugin, TAbstractFile } from 'obsidian';
import { registerTaskRowsView } from './bases-adapter.ts';
import { TaskIndex } from './indexer.ts';

export default class TaskRowsPlugin extends Plugin {
	private index!: TaskIndex;

	async onload(): Promise<void> {
		this.index = new TaskIndex(this.app);

		// Drop cached tasks when files change. Bases itself calls onDataUpdated afterwards,
		// which re-indexes only the invalidated files (others hit the mtime cache).
		// Use metadataCache 'changed' rather than vault 'modify': on 'modify' the list-item
		// positions may still be stale, and we would cache them under the new mtime.
		const drop = (file: TAbstractFile, oldPath?: string) => this.index.invalidate(file, oldPath);
		this.registerEvent(this.app.metadataCache.on('changed', (f) => drop(f)));
		this.registerEvent(this.app.vault.on('delete', (f) => drop(f)));
		this.registerEvent(this.app.vault.on('rename', (f, oldPath) => drop(f, oldPath)));

		if (!registerTaskRowsView(this, this.index)) {
			new Notice('Task rows needs the Bases core plugin, which is off in this vault.');
		}
	}
}
