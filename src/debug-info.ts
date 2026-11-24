// The text of "Copy debug info": versions and settings for a bug report. Pure, so tests can check
// what it contains. It never receives note content, file names or folder names.

export interface PluginFact {
	version: string;
	enabled: boolean;
}

export interface DebugFacts {
	tasklines: string;
	obsidian: string;
	platform: string;
	language: string;
	/** Minutes east of UTC. */
	utcOffset: number;
	theme: string;
	snippets: number;
	basesEnabled: boolean;
	communityPlugins: number;
	tasks: PluginFact | null;
	dataview: PluginFact | null;
	completionDate: string;
	useTasksPlugin: boolean;
	newFieldFormat: string;
	customStatuses: boolean;
	excludedFolders: number;
}

export function formatUtcOffset(minutes: number): string {
	const abs = Math.abs(minutes);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `UTC${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const plugin = (p: PluginFact | null) => (p ? `${p.version} (${p.enabled ? 'on' : 'off'})` : 'not installed');

export function formatDebugInfo(f: DebugFacts): string {
	return [
		`Tasklines: ${f.tasklines}`,
		`Obsidian: ${f.obsidian}`,
		`Platform: ${f.platform}`,
		`Language: ${f.language}, ${formatUtcOffset(f.utcOffset)}`,
		`Theme: ${f.theme}, ${f.snippets} CSS snippet${f.snippets === 1 ? '' : 's'}`,
		`Bases: ${f.basesEnabled ? 'on' : 'off'}`,
		`Tasks plugin: ${plugin(f.tasks)}`,
		`Dataview: ${plugin(f.dataview)}`,
		`Community plugins on: ${f.communityPlugins}`,
		`Settings: completion date ${f.completionDate}, use Tasks ${f.useTasksPlugin ? 'yes' : 'no'}, new fields ${f.newFieldFormat}, custom statuses ${f.customStatuses ? 'yes' : 'no'}, excluded folders ${f.excludedFolders}`,
	].join('\n');
}
