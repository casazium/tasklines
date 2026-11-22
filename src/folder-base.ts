// A ready-made .base file for one folder's tasks: a list, two boards and a calendar.
// Pure: no Obsidian runtime, so tests can check the file it writes.

/**
 * Where the new base goes: inside the folder, named after it, never over an existing file.
 * `exists` should ignore case: on macOS and Windows `a.base` and `A.base` are one file.
 */
export function folderBasePath(folder: string, exists: (path: string) => boolean): string {
	const dir = folder === '/' ? '' : folder.replace(/\/+$/, '');
	const name = dir ? (dir.split('/').pop() ?? dir).trim() : '';
	const stem = `${dir ? `${dir}/` : ''}${name ? `${name} tasks` : 'Tasks'}`;
	let path = `${stem}.base`;
	for (let n = 2; exists(path); n++) path = `${stem} ${n}.base`;
	return path;
}

/** The .base file for `folder` ('' or '/' for the whole vault). */
export function folderBaseContent(folder: string): string {
	const dir = folder === '/' ? '' : folder.replace(/\/+$/, '');
	const y = (s: string) => JSON.stringify(s);
	const out: string[] = [`# Created by Tasklines for ${dir ? `the folder ${y(dir)} and its subfolders` : 'the whole vault'}.`];
	if (dir) out.push('filters:', '  and:', `    - ${y(`file.inFolder(${y(dir)})`)}`);
	out.push(
		'views:',
		'  - type: tasklines',
		'    name: Open tasks',
		'    order:',
		'      - file.name',
		'    taskQuery:',
		'      statuses: [todo, in-progress, other]',
		'      sort:',
		'        - key: due',
		'          desc: false',
		'      group: note',
		'  - type: tasklines-board',
		'    name: Board',
		'    boardField: status',
		'    taskQuery:',
		'      doneWithinDays: 14',
		'  - type: tasklines-board',
		'    name: Urgent and important',
		'    boardField: eisenhower',
		'    taskQuery:',
		'      statuses: [todo, in-progress, other]',
		'  - type: tasklines-calendar',
		'    name: Calendar',
		'    calendarField: due',
	);
	return out.join('\n') + '\n';
}
