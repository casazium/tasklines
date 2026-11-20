import { App, PluginSettingTab, Setting, type Plugin } from 'obsidian';
import type { FieldFormat } from './edit.ts';
import { configureStatuses, DEFAULT_STATUSES, formatStatusSetting, parseStatusSetting } from './parser.ts';
import type { CompletionDate } from './writeback.ts';

export interface TasklinesSettings {
	completionDate: CompletionDate;
	useTasksPlugin: boolean;
	/** Style for dates or priority added to a task line that has no metadata yet. */
	newFieldFormat: FieldFormat;
	/** One status per line: `char | name | kind`. */
	statuses: string;
	/** Folders whose notes are never indexed, one per line. */
	excludeFolders: string;
}

export const DEFAULT_SETTINGS: TasklinesSettings = {
	completionDate: 'auto',
	useTasksPlugin: true,
	newFieldFormat: 'tasks-emoji',
	statuses: formatStatusSetting(DEFAULT_STATUSES),
	excludeFolders: '',
};

/** Apply settings that affect parsing. Call on load and after each change. */
export function applyStatusSetting(settings: TasklinesSettings): string[] {
	const { defs, errors } = parseStatusSetting(settings.statuses);
	configureStatuses(defs.length ? defs : DEFAULT_STATUSES);
	return errors;
}

export function excludedFolders(settings: TasklinesSettings): string[] {
	return settings.excludeFolders
		.split(/\r?\n/)
		.map((f) => f.trim().replace(/^\/+|\/+$/g, ''))
		.filter(Boolean);
}

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

		new Setting(containerEl).setName('Completing tasks').setHeading();
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

		new Setting(containerEl).setName('Editing tasks').setHeading();
		new Setting(containerEl)
			.setName('Style for new fields on plain tasks')
			.setDesc('When you set a date or priority on a task with no metadata yet. Tasks that already use a style keep it.')
			.addDropdown((d) =>
				d
					.addOptions({ 'tasks-emoji': 'Tasks emoji (📅 2026-01-31)', dataview: 'Dataview field ([due:: 2026-01-31])' })
					.setValue(this.settings.newFieldFormat)
					.onChange(async (v) => {
						this.settings.newFieldFormat = v as FieldFormat;
						await this.save();
					}),
			);

		const statusSetting = new Setting(containerEl)
			.setName('Task statuses')
			.setDesc('One per line: character | name | kind. Kind is todo, in-progress, done, cancelled or other. Space, x and - always mean to do, done and cancelled.');
		const errorsEl = containerEl.createDiv({ cls: 'setting-item-description mod-warning' });
		const showErrors = (errors: string[]) => errorsEl.setText(errors.join(' '));
		statusSetting.addTextArea((t) => {
			t.inputEl.rows = 10;
			t.inputEl.addClass('tasklines-status-setting');
			t.setValue(this.settings.statuses).onChange(async (v) => {
				this.settings.statuses = v;
				showErrors(applyStatusSetting(this.settings));
				await this.save();
			});
		});
		statusSetting.addExtraButton((b) =>
			b
				.setIcon('reset')
				.setTooltip('Restore defaults')
				.onClick(async () => {
					this.settings.statuses = DEFAULT_SETTINGS.statuses;
					applyStatusSetting(this.settings);
					await this.save();
					this.display();
				}),
		);
		showErrors(parseStatusSetting(this.settings.statuses).errors);

		new Setting(containerEl).setName('Indexing').setHeading();
		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('Tasks in these folders (one per line) never appear, even if a base selects their notes. Useful for templates and archives.')
			.addTextArea((t) => {
				t.inputEl.rows = 4;
				t.setPlaceholder('Templates\nArchive/2024')
					.setValue(this.settings.excludeFolders)
					.onChange(async (v) => {
						this.settings.excludeFolders = v;
						await this.save();
					});
			});
	}
}
