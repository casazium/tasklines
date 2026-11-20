// Writes task changes back to notes. The only code that modifies existing lines, and
// only through Vault.process (atomic read-modify-write). What to write is decided by the
// pure functions in writeback.ts and edit.ts; this file adds Obsidian I/O and notices.

import { Notice, TFile, type App } from 'obsidian';
import type { TaskEdit } from './edit.ts';
import type { TaskIndex } from './indexer.ts';
import type { TasklinesSettings } from './settings.ts';
import { localDate } from './view.ts';
import { editInContent, toggleInContent, type ToggleOptions } from './writeback.ts';

export interface TaskTarget {
	path: string;
	line: number;
	raw: string;
}

type TasksApi = { executeToggleTaskDoneCommand?: (line: string, path: string) => string };
type Failure = { ok: false; reason: string; detail: string };
type Computed = { ok: true; content: string; changed?: boolean } | Failure;

const FAILURE_TEXT: Record<string, string> = {
	'line-missing': 'The task is no longer in the note.',
	'line-changed': 'The task line changed since the view was drawn.',
	'not-a-task': 'That line is no longer a task.',
	'recurring-needs-tasks': 'Completing a recurring task needs the Tasks plugin (7.2.0 or later), so the next occurrence is created. Open the note to complete it there.',
	'bad-external-output': 'The Tasks plugin returned an unexpected result.',
	'invalid-edit': 'That edit could not be applied.',
};

export class TaskWriter {
	private pending = new Set<string>();

	constructor(
		private app: App,
		private index: TaskIndex,
		private settings: TasklinesSettings,
	) {}

	/** The Tasks plugin's toggle function, if Tasks is enabled, new enough and allowed. */
	private tasksToggle(): TasksApi['executeToggleTaskDoneCommand'] | undefined {
		if (!this.settings.useTasksPlugin) return undefined;
		// `app.plugins` is not in the public typings; Tasks documents this access path.
		const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, { apiV1?: TasksApi } | undefined> } }).plugins;
		const fn = plugins?.plugins?.['obsidian-tasks-plugin']?.apiV1?.executeToggleTaskDoneCommand;
		return typeof fn === 'function' ? fn : undefined;
	}

	tasksPluginAvailable(): boolean {
		return this.tasksToggle() !== undefined;
	}

	private options(): ToggleOptions {
		const tasks = this.tasksToggle();
		return {
			today: localDate(new Date()),
			completionDate: this.settings.completionDate,
			plainGetsEmojiDate: tasks !== undefined,
			newFieldFormat: this.settings.newFieldFormat,
		};
	}

	/** Toggle one task done/open. Returns true if the note was changed. */
	async toggle(target: TaskTarget): Promise<boolean> {
		const tasks = this.tasksToggle();
		const opts = this.options();
		const withTasks: ToggleOptions = { ...opts, external: tasks ? (line) => tasks(line, target.path) : undefined };
		return this.run(target, (data, precheck) => {
			// The precheck runs without the Tasks plugin so it has no side effects; a recurring
			// task is only refused there if Tasks is not available to handle it.
			if (precheck) {
				const r = toggleInContent(data, target, opts);
				return !r.ok && r.reason === 'recurring-needs-tasks' && tasks ? { ok: true, content: data } : r;
			}
			return toggleInContent(data, target, withTasks);
		});
	}

	/** Change one field (status, date or priority) of one task. */
	async edit(target: TaskTarget, edit: TaskEdit): Promise<boolean> {
		const opts = this.options();
		return this.run(target, (data) => editInContent(data, target, edit, opts));
	}

	private async run(target: TaskTarget, compute: (data: string, precheck: boolean) => Computed): Promise<boolean> {
		const key = `${target.path}:${target.line}`;
		if (this.pending.has(key)) return false;
		const file = this.app.vault.getAbstractFileByPath(target.path);
		if (!(file instanceof TFile)) {
			new Notice('Tasklines: the note was moved or deleted. Nothing was changed.');
			return false;
		}
		this.pending.add(key);
		try {
			// Check first without writing, so a refusal never touches the file or its mtime.
			const pre = compute(await this.app.vault.read(file), true);
			if (!pre.ok) return this.refuse(file, pre);
			if (pre.changed === false) return false;

			// Re-verify inside the atomic write: the file may have changed since the read.
			let outcome: Computed | null = null;
			await this.app.vault.process(file, (data) => {
				const r = compute(data, false);
				outcome = r;
				return r.ok ? r.content : data;
			});
			const result = outcome as Computed | null;
			if (!result) return false;
			if (!result.ok) return this.refuse(file, result);
			return true;
		} catch (err) {
			console.error('Tasklines: write failed', err);
			new Notice('Tasklines: could not write the change. Nothing was changed.');
			return false;
		} finally {
			this.pending.delete(key);
		}
	}

	private refuse(file: TFile, result: Failure): false {
		new Notice(`Tasklines: ${FAILURE_TEXT[result.reason] ?? result.detail} Nothing was changed.`, 8000);
		// Re-index the note so the view shows what is really there now.
		this.index.invalidate(file);
		return false;
	}
}
