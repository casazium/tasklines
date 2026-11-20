import { App, PluginSettingTab, Setting, type Plugin } from 'obsidian';
import type { CompletionDate } from './writeback.ts';

export interface TasklinesSettings {
	completionDate: CompletionDate;
	useTasksPlugin: boolean;
}

export const DEFAULT_SETTINGS: TasklinesSettings = {
	completionDate: 'auto',
	useTasksPlugin: true,
};

export class TasklinesSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: Plugin,
		private settings: TasklinesSettings,
		private save: () => Promise<void>,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Add a completion date when ticking a task')
			.setDesc('Uses the format the task already has: ✅ for Tasks-style lines, [completion:: …] for Dataview-style lines. Plain lines get ✅ only when the Tasks plugin is installed.')
			.addToggle((t) =>
				t.setValue(this.settings.completionDate === 'auto').onChange(async (v) => {
					this.settings.completionDate = v ? 'auto' : 'off';
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName('Let the Tasks plugin complete tasks')
			.setDesc('When the Tasks plugin (7.2.0 or later) is enabled, it decides the new line, so recurrence, done dates and custom statuses follow your Tasks settings. Recurring tasks cannot be completed from this view without it.')
			.addToggle((t) =>
				t.setValue(this.settings.useTasksPlugin).onChange(async (v) => {
					this.settings.useTasksPlugin = v;
					await this.save();
				}),
			);
	}
}
