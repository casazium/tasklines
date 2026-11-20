# Manual checks in Obsidian

The automated tests cover parsing, extraction, querying and the byte-level write-back logic. They can't cover Bases itself, the DOM or the Tasks plugin. Run these checks in `test-vault/` with Obsidian 1.10 or newer (`npm run build`, then copy `main.js`, `manifest.json` and `styles.css` into `test-vault/.obsidian/plugins/task-rows/`).

## Milestone 1: reading
- [ ] `Project tasks.base` opens, and the **Task rows** view lists tasks from `Alpha` and `Beta` only. `NoTasks` and the checkbox inside the code block are absent.
- [ ] The `status` and `owner` columns show the note's values. Adding a property in the Properties menu adds a column.
- [ ] The task inside the callout (`> - [ ] Task inside a callout`) appears. If it doesn't, the metadata cache skips callout list items.
- [ ] Subtasks are indented, including the grandchild under a plain bullet.
- [ ] Clicking a task opens the note **at that line**. Cmd/Ctrl-click opens it in a new tab.
- [ ] **Body-only edit:** with the base open in a split, type a new `- [ ] task` into `Alpha` in the editor. The view updates within about a second.
- [ ] A note that had no tasks gets its first one: the view updates.
- [ ] Rename `Beta` to `Beta 2`, then delete it: the rows follow, then disappear.

## Milestone 2: filter, sort, group
- [ ] The view fills the pane height and scrolls. If it is 320px tall in a tall pane, the Bases container has no height, so fix the CSS.
- [ ] Toolbar changes apply at once and survive closing and reopening the base (check that `taskQuery` appears in the `.base` file).
- [ ] Typing in the search box doesn't lose focus or characters while the `.base` file saves.
- [ ] The three views in the test base show their saved presets.
- [ ] Group by `owner` (a note property) and sort by `size` work.
- [ ] Turning off **Show task toolbar** hides it.
- [ ] Performance: generate a large vault (see `bench/bench.ts` for a note template), open a base over it, then scroll, filter and group without visible lag.

## Milestone 3: write-back
- [ ] Ticking `Write announcement` in the view changes only that line in `Alpha.md` to `- [x] … ✅ <today>`. Check with `git diff` if the vault is under git.
- [ ] Unticking removes the `✅` date again.
- [ ] `Dataview style` gets `[completion:: <today>]`.
- [ ] `Has a block id` gets the `✅` date **before** `^beta-block`.
- [ ] Without the Tasks plugin: ticking the recurring task shows a notice and changes nothing.
- [ ] With Tasks 7.2.0 or newer enabled: ticking the recurring task creates the next occurrence (two lines) the same way Tasks does in the editor. Note which line comes first.
- [ ] With the Tasks setting off: tasks still toggle, and recurring ones are refused.
- [ ] **Mismatch:** open `Alpha.md`, edit a task's text, then *immediately* (before the view refreshes) tick it in the view. You get a "task line changed" notice and the file is unchanged.
- [ ] Ticking a task while the same note is open in an editor: the editor updates, and undo in the editor still works.
- [ ] Double-clicking a checkbox quickly toggles once, not twice.

## MVP acceptance
- [ ] A 10,000-task vault renders and filters without visible lag.
- [ ] Disable the plugin: every note opens normally, and `Project tasks.base` still opens (Bases shows the unknown view type, or falls back) with no YAML errors. Re-enabling restores the views.
