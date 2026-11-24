// Writes task changes back to notes. The only code that modifies existing lines, and
// only through Vault.process (atomic read-modify-write). What to write is decided by the
// pure functions in writeback.ts and edit.ts; this file adds Obsidian I/O and notices.

import { Notice, TFile, type App } from 'obsidian';
import type { TaskEdit } from './edit.ts';
import type { TaskIndex } from './indexer.ts';
import type { TasklinesSettings } from './settings.ts';
import { localDate } from './view.ts';
import { editInContent, insertTaskInContent, replaceLineInContent, toggleInContent, type NewTask, type ToggleOptions } from './writeback.ts';

export interface TaskTarget {
	path: string;
	line: number;
	raw: string;
}

type TasksApi = { executeToggleTaskDoneCommand?: (line: string, path: string) => string };
type Failure = { ok: false; reason: string; detail: string };
type Computed = { ok: true; content: string; changed?: boolean; newLine?: string; newLines?: string[] } | Failure;

/** What one write did. `lines` are the lines now in place of the target (two for a recurring completion). */
export type WriteResult =
	| { status: 'written'; lines: string[] }
	| { status: 'unchanged' }
	| { status: 'refused'; reason: string; message: string }
	| { status: 'busy' | 'missing' | 'error'; message: string };

/** Settings read once per batch, so each task in it does not re-read them. */
export interface BatchContext {
	today: string;
	tasksGlobalFilter: string | undefined;
}

/** One step of a batch: an edit, or the checkbox's toggle (which must end done). */
export type BatchOp = { kind: 'edit'; edit: TaskEdit } | { kind: 'toggle' };

const FAILURE_TEXT: Record<string, string> = {
	'line-missing': 'The task is no longer in the note.',
	'line-changed': 'The task line changed since the view was drawn.',
	'not-a-task': 'That line is no longer a task.',
	'recurring-needs-tasks': 'Completing a recurring task needs the Tasks plugin (7.2.0 or later), so the next occurrence is created. Open the note to complete it there.',
	'bad-external-output': 'The Tasks plugin returned an unexpected result.',
	'recurring-outside-global-filter':
		'This recurring task does not contain your Tasks global filter, so the Tasks plugin would complete it without creating the next occurrence. Add the filter to the line, or complete it in the note.',
	'not-completed': 'The Tasks plugin would move this task to a status other than done (it follows your Tasks status cycle). Complete it in the note instead.',
	'invalid-edit': 'That change could not be made safely on this line (it has repeated or ambiguous fields). Make it in the note instead.',
	'tasks-localized-dates':
		"The Tasks plugin would write this recurring task's dates in your language's digits, which can't be read back as dates. To complete it, switch Obsidian to a language that uses 0-9, or edit the line by hand.",
	'tasks-format-mismatch':
		'The Tasks plugin is set to a different task format than this line uses (emoji or Dataview), so it cannot create the next occurrence. Change the format in the Tasks settings, or complete it in the note.',
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

	/** The Tasks plugin's global filter (from its saved settings), or undefined if none. */
	private async tasksGlobalFilter(): Promise<string | undefined> {
		const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, { loadData?: () => Promise<unknown> } | undefined> } }).plugins;
		try {
			const data = (await plugins?.plugins?.['obsidian-tasks-plugin']?.loadData?.()) as { globalFilter?: unknown } | null | undefined;
			const filter = typeof data?.globalFilter === 'string' ? data.globalFilter.trim() : '';
			return filter || undefined;
		} catch {
			return undefined;
		}
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
	async toggle(target: TaskTarget, expectDone = false): Promise<boolean> {
		const tasks = this.tasksToggle();
		const tasksGlobalFilter = tasks ? await this.tasksGlobalFilter() : undefined;
		return (await this.runDetailed(target, this.toggleCompute(target, expectDone, tasksGlobalFilter, this.options()), false)).status === 'written';
	}

	private toggleCompute(target: TaskTarget, expectDone: boolean, tasksGlobalFilter: string | undefined, base: ToggleOptions) {
		const tasks = this.tasksToggle();
		const opts: ToggleOptions = { ...base, expectDone };
		const withTasks: ToggleOptions = { ...opts, tasksGlobalFilter, external: tasks ? (line) => tasks(line, target.path) : undefined };
		return (data: string, precheck: boolean): Computed => {
			// The precheck runs without the Tasks plugin so it has no side effects; a recurring
			// task is only refused there if Tasks is not available to handle it.
			if (precheck) {
				const r = toggleInContent(data, target, opts);
				return !r.ok && r.reason === 'recurring-needs-tasks' && tasks ? { ok: true, content: data } : r;
			}
			return toggleInContent(data, target, withTasks);
		};
	}

	/** Read once before a batch: today's date and the Tasks global filter. */
	async batchContext(): Promise<BatchContext> {
		return { today: localDate(new Date()), tasksGlobalFilter: this.tasksToggle() ? await this.tasksGlobalFilter() : undefined };
	}

	/**
	 * One step of a batch, quietly: no notice and no re-index on refusal (the caller reports the
	 * whole batch and refreshes the notes it touched). Same checks as any single write.
	 */
	async applyStep(target: TaskTarget, op: BatchOp, ctx: BatchContext): Promise<WriteResult> {
		const opts: ToggleOptions = { ...this.options(), today: ctx.today };
		if (op.kind === 'toggle') return this.runDetailed(target, this.toggleCompute(target, true, ctx.tasksGlobalFilter, opts), true);
		return this.runDetailed(target, (data) => editInContent(data, target, op.edit, opts), true);
	}

	/** Undo of one batch step, quietly; refuses unless the line is still what the batch wrote. */
	async restoreQuiet(target: TaskTarget, original: string): Promise<WriteResult> {
		return this.runDetailed(target, (data) => replaceLineInContent(data, target, original), true);
	}

	/** Re-index notes after a quiet batch, so views show what is really there. */
	refresh(paths: Iterable<string>): void {
		for (const path of new Set(paths)) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) this.index.invalidate(file);
		}
	}

	/** Plain words for a refusal reason. */
	describe(reason: string): string {
		return FAILURE_TEXT[reason] ?? reason;
	}

	/** Change one field (status, date or priority) of one task. */
	async edit(target: TaskTarget, edit: TaskEdit): Promise<boolean> {
		return (await this.editLine(target, edit)) !== null;
	}

	/** Like edit(), but resolves to the line as written (for undo), or null if nothing changed. */
	async editLine(target: TaskTarget, edit: TaskEdit): Promise<string | null> {
		const opts = this.options();
		const r = await this.runDetailed(target, (data) => editInContent(data, target, edit, opts), false);
		return r.status === 'written' ? (r.lines[0] ?? null) : null;
	}

	/**
	 * Put a line back as it was (undo of a board move). Only if the line is still exactly what
	 * the move wrote; otherwise it refuses like any other change.
	 */
	async restore(target: TaskTarget, original: string): Promise<boolean> {
		return this.run(target, (data) => replaceLineInContent(data, target, original));
	}

	/**
	 * Add a task to a note, after its last task (so it joins that list) or at the end if the
	 * note has none. The anchor task is verified like any edit before the line is inserted.
	 */
	async add(path: string, task: NewTask): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice('Tasklines: that note no longer exists.');
			return false;
		}
		const tasks = (await this.index.tasksFor([file])).get(path) ?? [];
		const last = tasks.reduce<(typeof tasks)[number] | undefined>((a, t) => (!a || t.line > a.line ? t : a), undefined);
		const anchor = last ? { path, line: last.line, raw: last.raw } : null;
		const opts = this.options();
		const target = anchor ?? { path, line: -1, raw: '' };
		return this.run(target, (data) => insertTaskInContent(data, anchor, task, opts));
	}

	private async run(target: TaskTarget, compute: (data: string, precheck: boolean) => Computed): Promise<boolean> {
		return (await this.runDetailed(target, compute, false)).status === 'written';
	}

	/** One checked write. Quiet: no notices and no re-index; the caller reports. */
	private async runDetailed(target: TaskTarget, compute: (data: string, precheck: boolean) => Computed, quiet: boolean): Promise<WriteResult> {
		const key = `${target.path}:${target.line}`;
		if (this.pending.has(key)) return { status: 'busy', message: 'Another change to this task was still being written.' };
		const file = this.app.vault.getAbstractFileByPath(target.path);
		if (!(file instanceof TFile)) {
			const message = 'The note was moved or deleted.';
			if (!quiet) new Notice(`Tasklines: ${message} Nothing was changed.`);
			return { status: 'missing', message };
		}
		this.pending.add(key);
		const refused = (f: Failure): WriteResult => {
			if (!quiet) this.refuse(file, f, target.line);
			return { status: 'refused', reason: f.reason, message: FAILURE_TEXT[f.reason] ?? f.detail };
		};
		try {
			// Check first without writing, so a refusal never touches the file or its mtime.
			const pre = compute(await this.app.vault.read(file), true);
			if (!pre.ok) return refused(pre);
			if (pre.changed === false) return { status: 'unchanged' };

			// Re-verify inside the atomic write: the file may have changed since the read.
			let outcome: Computed | null = null;
			await this.app.vault.process(file, (data) => {
				const r = compute(data, false);
				outcome = r;
				return r.ok ? r.content : data;
			});
			const result = outcome as Computed | null;
			if (!result) return { status: 'unchanged' };
			if (!result.ok) return refused(result);
			if (result.changed === false) return { status: 'unchanged' };
			return { status: 'written', lines: result.newLines ?? (result.newLine !== undefined ? [result.newLine] : []) };
		} catch (err) {
			console.error('Tasklines: write failed', err);
			const message = 'Could not write the change.';
			if (!quiet) new Notice(`Tasklines: ${message} Nothing was changed.`);
			return { status: 'error', message };
		} finally {
			this.pending.delete(key);
		}
	}

	private refuse(file: TFile, result: Failure, line: number): false {
		const message = new DocumentFragment();
		message.createDiv({ text: `Tasklines: ${FAILURE_TEXT[result.reason] ?? result.detail} Nothing was changed.` });
		// Offer the editor, where the Tasks plugin's own handling runs, one click away.
		if (line >= 0) {
			const open = message.createEl('button', { text: 'Open at line', cls: 'mod-cta tasklines-notice-btn' });
			open.addEventListener('click', () => {
				void this.app.workspace.getLeaf(false).openFile(file, { eState: { line } });
			});
		}
		new Notice(message, 10000);
		// Re-index the note so the view shows what is really there now.
		this.index.invalidate(file);
		return false;
	}
}
