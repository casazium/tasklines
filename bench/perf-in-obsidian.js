// Timing script for Tasklines inside Obsidian. Copied into a generated perf vault and run
// from the developer console with:
//   eval(await app.vault.adapter.read('perf.js'))
// Writes perf-results.json to the vault root.
(async () => {
	const results = {};
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
	const now = () => performance.now();
	const until = async (pred, max = 60000) => {
		const s = now();
		while (!pred()) {
			if (now() - s > max) return -1;
			await wait(5);
		}
		return now() - s;
	};
	const root = () => document.querySelector('.workspace-leaf.mod-active .tasklines-view');
	const stats = () => root()?.querySelector('.tasklines-stats')?.textContent ?? '';
	const rowsInDom = () => root()?.querySelectorAll('.tasklines-row').length ?? 0;
	const changed = async (before, max) => until(() => stats() !== before && rowsInDom() >= 0, max);

	// 1. Metadata cache: how many notes Obsidian has indexed.
	const md = app.vault.getMarkdownFiles();
	results.notes = md.length;
	results.cacheReadyMs = await until(() => md.every((f) => app.metadataCache.getFileCache(f)), 120000);

	// 2. First open of the base (cold Tasklines cache).
	const base = app.vault.getAbstractFileByPath('All tasks.base');
	let t = now();
	await app.workspace.getLeaf('tab').openFile(base);
	await until(() => rowsInDom() > 0);
	results.firstOpenMs = Math.round(now() - t);
	results.firstOpenStats = stats();
	results.rowsInDom = rowsInDom();

	// 3. Second open (warm cache): close and reopen.
	app.workspace.activeLeaf?.detach();
	await wait(300);
	t = now();
	await app.workspace.getLeaf('tab').openFile(base);
	await until(() => rowsInDom() > 0);
	results.warmOpenMs = Math.round(now() - t);
	await wait(500);

	// 4. Filter: add Done to the status chips.
	let before = stats();
	const done = [...root().querySelectorAll('.tasklines-chip')].find((b) => b.textContent === 'Done');
	t = now();
	done.click();
	await changed(before);
	results.filterMs = Math.round(now() - t);
	results.filterStats = stats();

	// 5. Group by priority.
	before = stats();
	const group = root().querySelector('select[aria-label="Group tasks by"]');
	t = now();
	group.value = 'priority';
	group.dispatchEvent(new Event('change'));
	// Done when the group headers are priority names (this vault has high/medium/low/none).
	await until(() => [...root().querySelectorAll('.tasklines-group-label')].some((g) => ['high', 'medium', 'low', 'none'].includes(g.textContent ?? '')));
	results.groupMs = Math.round(now() - t);

	// 6. Text search (includes the toolbar's 300 ms typing pause).
	before = stats();
	const search = root().querySelector('input[aria-label="Search task text"]');
	t = now();
	search.value = 'note 42';
	search.dispatchEvent(new Event('input'));
	await changed(before);
	results.searchMsIncluding300msPause = Math.round(now() - t);
	results.searchStats = stats();
	search.value = '';
	search.dispatchEvent(new Event('input'));
	await wait(800);

	// 7. Scroll through the list: frame times while jumping 1,500 px per frame.
	const scroller = root().querySelector('.tasklines-scroller');
	const frames = [];
	let last = now();
	for (let i = 0; i < 60; i++) {
		scroller.scrollTop += 1500;
		await frame();
		const n = now();
		frames.push(n - last);
		last = n;
	}
	frames.sort((a, b) => a - b);
	results.scrollFrameMs = {
		median: Math.round(frames[30]),
		p95: Math.round(frames[57]),
		max: Math.round(frames[59]),
		rowsInDomWhileScrolling: rowsInDom(),
	};
	scroller.scrollTop = 0;

	// 8. Refresh after an edit made outside the view (like ticking a task in the editor).
	before = stats();
	const note = app.vault.getAbstractFileByPath('Notes/00/Note 2.md');
	t = now();
	await app.vault.process(note, (d) => d + '- [ ] Added by perf test 📅 2026-11-21\n');
	const refreshWait = await changed(before, 10000);
	results.refreshAfterEditMs = refreshWait < 0 ? 'no refresh within 10 s' : Math.round(now() - t);
	results.refreshStats = stats();

	results.ranAt = new Date().toISOString();
	await app.vault.adapter.write('perf-results.json', JSON.stringify(results, null, 2));
	console.log('Tasklines perf results', results);
})();
