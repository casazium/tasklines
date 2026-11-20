import { Notice, Plugin, TAbstractFile } from 'obsidian';
import { registerTasklinesView } from './bases-adapter.ts';
import { TaskIndex } from './indexer.ts';
import { DEFAULT_SETTINGS, TasklinesSettingTab, type TasklinesSettings } from './settings.ts';
import { TaskWriter } from './writer.ts';

export default class TasklinesPlugin extends Plugin {
	private index!: TaskIndex;
	private taskSettings: TasklinesSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		const saved = (await this.loadData()) as Partial<TasklinesSettings> | null;
		Object.assign(this.taskSettings, saved ?? {});
		this.addSettingTab(new TasklinesSettingTab(this.app, this, this.taskSettings, () => this.saveData(this.taskSettings)));

		this.index = new TaskIndex(this.app);
		const writer = new TaskWriter(this.app, this.index, this.taskSettings);

		// Drop cached tasks when files change. Bases itself calls onDataUpdated afterwards,
		// which re-indexes only the invalidated files (others hit the mtime cache).
		// Use metadataCache 'changed' rather than vault 'modify': on 'modify' the list-item
		// positions may still be stale, and we would cache them under the new mtime.
		const drop = (file: TAbstractFile, oldPath?: string) => this.index.invalidate(file, oldPath);
		this.registerEvent(this.app.metadataCache.on('changed', (f) => drop(f)));
		this.registerEvent(this.app.vault.on('delete', (f) => drop(f)));
		this.registerEvent(this.app.vault.on('rename', (f, oldPath) => drop(f, oldPath)));

		if (!registerTasklinesView(this, this.index, writer)) {
			new Notice('Tasklines needs the Bases core plugin, which is off in this vault.');
		}
	}
}
