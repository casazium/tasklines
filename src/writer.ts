// Writes a task toggle back to its note. The only code that modifies notes, and only
// through Vault.process (atomic read-modify-write). The decision of what to write is in
// writeback.ts; this file adds the Obsidian I/O, the Tasks plugin bridge and notices.

import { Notice, TFile, type App } from 'obsidian';
import type { TaskIndex } from './indexer.ts';
import type { TaskRowsSettings } from './settings.ts';
import { localDate } from './view.ts';
import { toggleInContent, type ToggleOptions, type ToggleResult } from './writeback.ts';

export interface TaskTarget {
	path: string;
	line: number;
	raw: string;
}

type TasksApi = { executeToggleTaskDoneCommand?: (line: string, path: string) => string };

const FAILURE_TEXT: Record<string, string> = {
	'line-missing': 'The task is no longer in the note.',
	'line-changed': 'The task line changed since the view was drawn.',
	'not-a-task': 'That line is no longer a task.',
	'recurring-needs-tasks': 'Completing a recurring task needs the Tasks plugin (7.2.0 or later), so the next occurrence is created. Open the note to complete it there.',
	'bad-external-output': 'The Tasks plugin returned an unexpected result.',
};

export class TaskWriter {
	private pending = new Set<string>();

	constructor(
		private app: App,
		private index: TaskIndex,
		private settings: TaskRowsSettings,
	) {}

	/** The Tasks plugin's toggle function, if Tasks is enabled, new enough and allowed. */
	private tasksToggle(): TasksApi['executeToggleTaskDoneCommand'] | undefined {
		if (!this.settings.useTasksPlugin) return undefined;
		// `app.plugins` is not in the public typings; Tasks documents this access path.
		const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, { apiV1?: TasksApi } | undefined> } }).plugins;
		const fn = plugins?.plugins?.['obsidian-tasks-plugin']?.apiV1?.executeToggleTaskDoneCommand;
		return typeof fn === 'function' ? fn : undefined;
	}

	isPending(t: TaskTarget): boolean {
		return this.pending.has(`${t.path}:${t.line}`);
	}

	/** Toggle one task. Returns true if the note was changed. */
	async toggle(target: TaskTarget): Promise<boolean> {
		const key = `${target.path}:${target.line}`;
		if (this.pending.has(key)) return false;
		const file = this.app.vault.getAbstractFileByPath(target.path);
		if (!(file instanceof TFile)) {
			new Notice('Task rows: the note was moved or deleted. Nothing was changed.');
			return false;
		}

		this.pending.add(key);
		try {
			const tasks = this.tasksToggle();
			const opts: ToggleOptions = {
				today: localDate(new Date()),
				completionDate: this.settings.completionDate,
				plainGetsEmojiDate: tasks !== undefined,
				external: tasks ? (line) => tasks(line, target.path) : undefined,
			};

			// Check first without writing, so a refusal never touches the file or its mtime.
			const precheck = toggleInContent(await this.app.vault.read(file), target, { ...opts, external: undefined });
			if (!precheck.ok && precheck.reason !== 'recurring-needs-tasks') return this.refuse(file, precheck);
			if (!precheck.ok && !tasks) return this.refuse(file, precheck);

			// Re-verify inside the atomic write: the file may have changed since the read.
			let outcome: ToggleResult | null = null;
			await this.app.vault.process(file, (data) => {
				outcome = toggleInContent(data, target, opts);
				return outcome.ok ? outcome.content : data;
			});
			const result = outcome as ToggleResult | null;
			if (!result) return false;
			if (!result.ok) return this.refuse(file, result);
			return true;
		} catch (err) {
			console.error('Task rows: write failed', err);
			new Notice('Task rows: could not write the change. Nothing was changed.');
			return false;
		} finally {
			this.pending.delete(key);
		}
	}

	private refuse(file: TFile, result: Extract<ToggleResult, { ok: false }>): false {
		new Notice(`Task rows: ${FAILURE_TEXT[result.reason] ?? result.detail} Nothing was changed.`, 8000);
		// Re-index the note so the view shows what is really there now.
		this.index.invalidate(file);
		return false;
	}
}
