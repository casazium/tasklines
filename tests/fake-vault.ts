// A minimal stand-in for Obsidian's App, vault and metadata cache, built from note text.
// List items are a rough guess at what the metadata cache reports (backtick fences excluded).
// It is good enough for indexer and query tests, but it differs from Obsidian on callouts,
// comments, loose lists and more: tests/obsidian-cache.test.ts checks extraction against
// Obsidian's real cache instead.

import type { App, TFile } from 'obsidian';

interface FakeFile { path: string; extension: string; basename: string; stat: { mtime: number }; content: string }

export class FakeVault {
	files = new Map<string, FakeFile>();
	reads = 0;
	private clock = 1;

	write(path: string, content: string): TFile {
		const existing = this.files.get(path);
		const f: FakeFile = existing ?? { path, extension: path.split('.').pop() ?? '', basename: path.replace(/^.*\//, '').replace(/\.[^.]+$/, ''), stat: { mtime: 0 }, content };
		f.content = content;
		f.stat.mtime = this.clock++;
		this.files.set(path, f);
		return f as unknown as TFile;
	}

	rename(oldPath: string, newPath: string): TFile {
		const f = this.files.get(oldPath);
		if (!f) throw new Error(`no file ${oldPath}`);
		this.files.delete(oldPath);
		f.path = newPath;
		f.basename = newPath.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
		this.files.set(newPath, f);
		return f as unknown as TFile;
	}

	remove(path: string): TFile {
		const f = this.files.get(path);
		if (!f) throw new Error(`no file ${path}`);
		this.files.delete(path);
		return f as unknown as TFile;
	}

	get(path: string): TFile {
		const f = this.files.get(path);
		if (!f) throw new Error(`no file ${path}`);
		return f as unknown as TFile;
	}

	all(): TFile[] {
		return [...this.files.values()] as unknown as TFile[];
	}

	app(): App {
		return {
			vault: {
				cachedRead: async (file: TFile) => {
					this.reads++;
					return this.files.get(file.path)?.content ?? '';
				},
			},
			metadataCache: { getFileCache: (file: TFile) => cacheFor(this.files.get(file.path)?.content ?? '') },
		} as unknown as App;
	}
}

const LIST = /^(\s*(?:>\s*)*)(?:[-*+]|\d+[.)])\s+(?:\[(.)\])?/;

function cacheFor(content: string) {
	const lines = content.split('\n');
	const listItems: Array<{ task?: string; parent: number; position: { start: { line: number } } }> = [];
	const headings: Array<{ heading: string; level: number; position: { start: { line: number } } }> = [];
	const stack: Array<{ indent: number; line: number }> = [];
	let inCode = false;
	let listStart = -1;
	lines.forEach((line, i) => {
		if (/^\s*```/.test(line)) { inCode = !inCode; return; }
		if (inCode) return;
		const h = /^(#{1,6})\s+(.*)$/.exec(line);
		if (h) { headings.push({ heading: h[2] ?? '', level: (h[1] ?? '').length, position: { start: { line: i } } }); stack.length = 0; listStart = -1; return; }
		const m = LIST.exec(line);
		if (!m) { if (line.trim() === '') { stack.length = 0; listStart = -1; } return; }
		const indent = (m[1] ?? '').replace(/\t/g, '    ').length;
		while (stack.length && (stack.at(-1)?.indent ?? 0) >= indent) stack.pop();
		if (listStart < 0) listStart = i;
		const parent = stack.length ? (stack.at(-1)?.line ?? 0) : -listStart;
		listItems.push({ task: m[2], parent, position: { start: { line: i } } });
		stack.push({ indent, line: i });
	});
	return { listItems: listItems.length ? listItems : undefined, headings };
}
