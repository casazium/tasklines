import { App, normalizePath, PluginSettingTab, type Plugin, type Setting, type SettingDefinitionItem, type TextAreaComponent } from 'obsidian';
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
		.map((f) => (f.trim() ? normalizePath(f.trim()) : ''))
		.filter(Boolean);
}

export class TasklinesSettingTab extends PluginSettingTab {
	private settings: TasklinesSettings;
	private save: () => Promise<void>;

	constructor(app: App, plugin: Plugin, settings: TasklinesSettings, save: () => Promise<void>) {
		super(app, plugin);
		this.settings = settings;
		this.save = save;
	}

	// Declarative settings (Obsidian 1.13+): Obsidian renders them and indexes them for settings search.
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Completing tasks',
				items: [
					{
						name: 'Add a completion date when ticking a task',
						desc: 'Uses the format the task already has: ✅ for Tasks-style lines, [completion:: …] for Dataview-style lines. Plain lines get ✅ only when the Tasks plugin is installed. Cancelling a task adds a ❌ or [cancelled:: …] date the same way.',
						control: { type: 'toggle', key: 'completionDate' },
					},
					{
						name: 'Let the Tasks plugin complete tasks',
						desc: 'When the Tasks plugin (7.2.0 or later) is enabled, it decides the new line, so recurrence, done dates and custom statuses follow your Tasks settings. Recurring tasks cannot be completed from this view without it.',
						control: { type: 'toggle', key: 'useTasksPlugin' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Editing tasks',
				items: [
					{
						name: 'Style for new fields on plain tasks',
						desc: 'When you set a date or priority on a task with no metadata yet. Tasks that already use a style keep it.',
						control: { type: 'dropdown', key: 'newFieldFormat', options: { 'tasks-emoji': 'Tasks emoji (📅 2026-01-31)', dataview: 'Dataview field ([due:: 2026-01-31])' } },
					},
					{
						name: 'Task statuses',
						desc: 'One per line: character | name | kind. Kind is todo, in-progress, done, cancelled or other. Space, x and - always mean to do, done and cancelled.',
						aliases: ['custom statuses', 'checkbox characters'],
						render: (setting) => this.renderStatuses(setting),
					},
				],
			},
			{
				type: 'group',
				heading: 'Indexing',
				items: [
					{
						name: 'Excluded folders',
						desc: 'Tasks in these folders (one per line) never appear, even if a base selects their notes. Useful for templates and archives.',
						control: { type: 'textarea', key: 'excludeFolders', rows: 4, placeholder: 'Templates\narchive/2024' },
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		// The completion date is stored as 'auto' | 'off' but shown as a toggle.
		if (key === 'completionDate') return this.settings.completionDate === 'auto';
		return this.settings[key as keyof TasklinesSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'completionDate') this.settings.completionDate = value ? 'auto' : 'off';
		else if (key === 'useTasksPlugin') this.settings.useTasksPlugin = Boolean(value);
		else if (key === 'newFieldFormat') this.settings.newFieldFormat = value as FieldFormat;
		else if (key === 'excludeFolders') this.settings.excludeFolders = typeof value === 'string' ? value : '';
		await this.save();
	}

	/** The statuses box: a tall text area, problems shown as you type, and a reset button. */
	private renderStatuses(setting: Setting): void {
		setting.setClass('tasklines-setting-stacked');
		const errorsEl = setting.descEl.createDiv({ cls: 'mod-warning' });
		const showErrors = (errors: string[]) => errorsEl.setText(errors.join(' '));
		let area: TextAreaComponent | null = null;
		setting.addTextArea((t) => {
			area = t;
			t.inputEl.rows = 10;
			t.inputEl.addClass('tasklines-status-setting');
			t.setValue(this.settings.statuses).onChange(async (v) => {
				this.settings.statuses = v;
				showErrors(applyStatusSetting(this.settings));
				await this.save();
			});
		});
		setting.addExtraButton((b) =>
			b
				.setIcon('reset')
				.setTooltip('Restore defaults')
				.onClick(async () => {
					this.settings.statuses = DEFAULT_SETTINGS.statuses;
					showErrors(applyStatusSetting(this.settings));
					area?.setValue(this.settings.statuses);
					await this.save();
				}),
		);
		showErrors(parseStatusSetting(this.settings.statuses).errors);
	}
}
