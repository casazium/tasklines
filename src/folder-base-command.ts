import { normalizePath, Notice, TFile, TFolder, type Plugin } from 'obsidian';
import { folderBaseContent, folderBasePath } from './folder-base.ts';

/** "New task base" for the current note's folder (command) or any folder (file menu). */
export function registerFolderBaseCommand(plugin: Plugin): void {
	const { app } = plugin;
	plugin.addCommand({
		id: 'create-folder-task-base',
		name: "New task base for the current note's folder",
		checkCallback: (checking: boolean) => {
			const folder = app.workspace.getActiveFile()?.parent;
			if (!folder) return false;
			if (!checking) void create(plugin, folder);
			return true;
		},
	});
	plugin.registerEvent(
		app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFolder)) return;
			menu.addItem((item) =>
				item
					.setTitle('New task base')
					.setIcon('list-checks')
					.setSection('action-primary')
					.onClick(() => void create(plugin, file)),
			);
		}),
	);
}

async function create(plugin: Plugin, folder: TFolder): Promise<void> {
	const { app } = plugin;
	const taken = new Set(app.vault.getAllLoadedFiles().map((f) => f.path.toLowerCase()));
	const path = normalizePath(folderBasePath(folder.path, (p) => taken.has(normalizePath(p).toLowerCase())));
	try {
		const file = await app.vault.create(path, folderBaseContent(folder.path));
		new Notice(`Tasklines: created ${file.name}, with a list, a board, an urgent-and-important board and a calendar.`);
		if (file instanceof TFile) await app.workspace.getLeaf('tab').openFile(file);
	} catch (err) {
		new Notice(`Tasklines: could not create ${path}: ${err instanceof Error ? err.message : String(err)}`);
	}
}
