import { apiVersion, getLanguage, Notice, Platform, type Plugin } from 'obsidian';
import { formatDebugInfo, type DebugFacts, type PluginFact } from './debug-info.ts';
import { DEFAULT_SETTINGS, excludedFolders, type TasklinesSettings } from './settings.ts';

// Not in the public typings. Every read is optional, so a change in Obsidian only blanks a line.
interface AppInternals {
	plugins?: { manifests?: Record<string, { version?: string } | undefined>; enabledPlugins?: Set<string> };
	internalPlugins?: { plugins?: Record<string, { enabled?: boolean } | undefined> };
	customCss?: { theme?: string; enabledSnippets?: Set<string> };
}

function platformName(): string {
	const os = Platform.isIosApp ? 'iOS' : Platform.isAndroidApp ? 'Android' : Platform.isMacOS ? 'macOS' : Platform.isWin ? 'Windows' : Platform.isLinux ? 'Linux' : 'unknown';
	return `${os} ${Platform.isPhone ? 'phone' : Platform.isTablet ? 'tablet' : 'desktop'}`;
}

/** "Copy debug info": versions and settings for a bug report, with no note content. */
export function registerDebugCommand(plugin: Plugin, settings: TasklinesSettings): void {
	plugin.addCommand({
		id: 'copy-debug-info',
		name: 'Copy debug info',
		callback: () => void copy(plugin, settings),
	});
}

async function copy(plugin: Plugin, settings: TasklinesSettings): Promise<void> {
	const app = plugin.app as unknown as AppInternals;
	const pluginFact = (id: string): PluginFact | null => {
		const manifest = app.plugins?.manifests?.[id];
		return manifest ? { version: manifest.version ?? 'unknown', enabled: app.plugins?.enabledPlugins?.has(id) ?? false } : null;
	};
	const facts: DebugFacts = {
		tasklines: plugin.manifest.version,
		obsidian: apiVersion,
		platform: platformName(),
		language: getLanguage(),
		utcOffset: -new Date().getTimezoneOffset(),
		theme: app.customCss?.theme || 'default',
		snippets: app.customCss?.enabledSnippets?.size ?? 0,
		basesEnabled: app.internalPlugins?.plugins?.bases?.enabled ?? false,
		communityPlugins: app.plugins?.enabledPlugins?.size ?? 0,
		tasks: pluginFact('obsidian-tasks-plugin'),
		dataview: pluginFact('dataview'),
		completionDate: settings.completionDate,
		useTasksPlugin: settings.useTasksPlugin,
		newFieldFormat: settings.newFieldFormat,
		customStatuses: settings.statuses !== DEFAULT_SETTINGS.statuses,
		excludedFolders: excludedFolders(settings).length,
	};
	try {
		await navigator.clipboard.writeText(formatDebugInfo(facts));
		new Notice('Tasklines: debug info copied. It has versions and settings, and no note content.');
	} catch (err) {
		new Notice(`Tasklines: could not copy debug info: ${err instanceof Error ? err.message : String(err)}`);
	}
}
