# Manual checks in Obsidian

The automated tests cover parsing, extraction, querying and the byte-level write-back logic. They can't cover Bases itself, the DOM or the Tasks plugin. Run these checks in `test-vault/` with Obsidian 1.10 or newer (`npm run build`, then copy `main.js`, `manifest.json` and `styles.css` into `test-vault/.obsidian/plugins/tasklines/`).

## Milestone 1: reading
- [ ] `Project tasks.base` opens, and the **Tasklines** view lists tasks from `Alpha` and `Beta` only. `NoTasks` and the checkbox inside the code block are absent.
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

## Milestone 4: v1
- [ ] Click a **Due** cell, pick a date, press Enter: only that line changes, in its own style (try `Write announcement` (emoji), `Dataview style` and a plain task).
- [ ] Clear a due date: the date token disappears and nothing else on the line changes.
- [ ] **Priority** and **Status** cells open a dropdown. Setting status to Done adds `✅ <today>`, and setting it back removes it.
- [ ] Escape or clicking away cancels an edit without writing.
- [ ] Add a custom status in Settings (e.g. `b | Blocked | in-progress`). It appears in the Status editor, and a `- [b]` task shows "Blocked" and counts as open.
- [ ] **New task** into `Alpha`: it lands after the last task in the Edge cases section (after the nested bullet), in Tasks emoji style. Into `NoTasks`: it lands at the end after a blank line.
- [ ] Switch on the computed columns. Overdue shows days late, Subtasks shows `done/total` on `Parent with nested bullet`, and Note progress matches the note.
- [ ] Group headers show `N open · N overdue · N done (x%)`.
- [ ] The completed-task window hides tasks completed more than N days ago.
- [ ] Add `Templates` to **Excluded folders**: the `Templates/Weekly.md` task disappears from any base that includes it.
- [ ] In `Dataview queries.md`, run the convert command in each block. A `.base` opens with the expected filters, and the second one lists the parts it couldn't convert. The note is unchanged.
- [ ] **Mobile** (iOS and Android): the view opens, rows are taller, checkboxes and cells can be tapped, the date picker opens, the toolbar wraps, and the grid scrolls sideways.

## Recurring tasks
- [ ] Recurring tasks show 🔁 with a "Repeats …" tooltip.
- [ ] Without Tasks: the recurring task's checkbox is dimmed with an explanation. Clicking it shows a notice with **Open at line**, which opens the note at the task.
- [ ] Tasks in **Dataview format** (Tasks settings → Task format): ticking `Recurring (Dataview)` in `Beta` creates the next occurrence in Dataview style.
- [ ] Tasks in **emoji format**: ticking `Recurring (Dataview)` is refused with the "different task format" notice, and the file is unchanged. Ticking `Dataview style` (not recurring) still completes it with `[completion:: …]`.
- [ ] A recurring task with `🏁 delete`: completing it from the view gives the same result as completing it in the editor. Note what Tasks does.

## MVP acceptance
- [ ] A 10,000-task vault renders and filters without visible lag.
- [ ] Disable the plugin: every note opens normally, and `Project tasks.base` still opens (Bases shows the unknown view type, or falls back) with no YAML errors. Re-enabling restores the views.
