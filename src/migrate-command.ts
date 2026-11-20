import { normalizePath, Notice, TFile, type Editor, type MarkdownFileInfo, type MarkdownView, type Plugin } from 'obsidian';
import { findDataviewBlock, migrationToBase, translateDataviewTask } from './dataview-migrate.ts';

/** Command: turn the Dataview TASK query under the cursor into a .base file next to the note. */
export function registerMigrateCommand(plugin: Plugin): void {
	plugin.addCommand({
		id: 'convert-dataview-task-query',
		name: 'Convert Dataview task query under cursor to a base',
		editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const block = findDataviewBlock(editor.getValue().split(/\r?\n/), editor.getCursor().line);
			if (!block || !/^\s*task\b/i.test(block.source) || !ctx.file) return false;
			if (!checking) void convert(plugin, ctx.file, block.source);
			return true;
		},
	});
}

async function convert(plugin: Plugin, note: TFile, source: string): Promise<void> {
	const { app } = plugin;
	let migration;
	try {
		migration = translateDataviewTask(source);
	} catch (err) {
		new Notice(`Tasklines: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}
	const folder = note.parent?.path && note.parent.path !== '/' ? `${note.parent.path}/` : '';
	let path = normalizePath(`${folder}${note.basename} tasks.base`);
	for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}${note.basename} tasks ${n}.base`);

	const file = await app.vault.create(path, migrationToBase(migration, 'Tasks', source));
	const name = file.name;
	const warn = migration.warnings.length;
	new Notice(
		`Tasklines: created ${name}${warn ? ` — ${warn} part${warn === 1 ? '' : 's'} need checking (listed at the top of the file)` : ''}. ` +
			`Your note is unchanged; embed the base with ![[${name}]].`,
		10000,
	);
	if (file instanceof TFile) await app.workspace.getLeaf('tab').openFile(file);
}
