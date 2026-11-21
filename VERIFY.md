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
- [x] **Mobile** (iOS and Android): the view opens, rows are taller, checkboxes and cells can be tapped, the date picker opens, and the grid scrolls sideways. The toolbar starts folded into one **Filter, sort, group (N)** button next to **New task**; tapping it shows all controls, and "Group" stays beside its dropdown. (Checked with `app.emulateMobile(true)` at phone width on desktop, then on a real iPhone and the Android emulator: see below.)

## Recurring tasks
- [ ] Recurring tasks show 🔁 with a "Repeats …" tooltip.
- [ ] Without Tasks: the recurring task's checkbox is dimmed with an explanation. Clicking it shows a notice with **Open at line**, which opens the note at the task.
- [ ] Tasks in **Dataview format** (Tasks settings → Task format): ticking `Recurring (Dataview)` in `Beta` creates the next occurrence in Dataview style.
- [ ] Tasks in **emoji format**: ticking `Recurring (Dataview)` is refused with the "different task format" notice, and the file is unchanged. Ticking `Dataview style` (not recurring) still completes it with `[completion:: …]`.
- [ ] A recurring task with `🏁 delete`: completing it from the view gives the same result as completing it in the editor. Note what Tasks does.

Findings from the first runs (0.9.0, Obsidian 1.15.1, Tasks 8.6.0): Tasks inserts the next occurrence **above** the completed line; callout tasks are indexed; the Settings window keeps the plugin code it was opened with, so **quit and reopen Obsidian** (not just Force Reload) after changing settings code.

## MVP acceptance

Run on 2026-11-20 with Tasklines 0.9.2 in Obsidian 1.15.1 (macOS), using `npm run perf-vault` (5,000 notes, 10,494 tasks) and `bench/perf-in-obsidian.js`:

- [x] **A 10,000-task vault renders and filters without visible lag.**

  | Step | Time |
  | --- | --- |
  | First open of the base (indexing 3,000 notes with tasks takes 42 ms of it) | 199 ms |
  | Reopening it | 130 to 143 ms |
  | Filter (add Done) | 45 to 51 ms |
  | Group by priority | 31 ms |
  | Text search, after the 300 ms typing pause | 33 to 41 ms |
  | Scrolling: frame time while jumping 1,500 px a frame | median 17 ms (60 fps), p95 17 to 18 ms |
  | Refresh after a note is edited elsewhere | 91 to 97 ms |

  Only 24 to 35 rows are ever in the page.
- [x] **Disabling the plugin leaves every note and `.base` file valid.** With Tasklines off, notes open and render normally. A base with Tasklines views still opens, and Bases shows "Unknown view type: tasklines" for those views. The `.base` file stays valid YAML.
- [x] **Real iPhone.** Run on 2026-11-20 on an iPhone with Obsidian for iOS, driven through iPhone Mirroring, with the test vault synced by iCloud. Every edit was diffed on the Mac afterwards.
  - The plugin loads in iOS's WebKit, and the base opens with the toolbar folded.
  - The toolbar opens and fits the width: status chips, search and the native Group menu all work; Reset and folding work.
  - Ticking a task, completing a recurring task through the Tasks plugin (new occurrence above), changing a due date with the iOS date picker, changing status and priority with native menus, and New task all wrote exactly the intended line. A new priority on a Dataview line was added as `[priority:: low]`, and a block ID stayed at the end.
  - The grid scrolls sideways to reach the columns after Status.
  - Found and fixed:
    - Rows were only as wide as the pane, so cells scrolled in from the right could not be tapped on iOS and row lines stopped short. Rows now span the whole grid.
    - An empty date or priority cell collapsed to zero height and could not be tapped, on any platform. Editable cells now fill the row.
    - Grouping by status showed `todo` instead of "To do".
  - Not covered here: the on-screen keyboard (iPhone Mirroring types with the Mac's keyboard). The Android run below covers it.
- [x] **Android.** Run on 2026-11-20 in the Android Studio emulator (Pixel-size phone, Android API 37, light theme) with Obsidian 1.15.1 from Obsidian's official GitHub release. The test vault was copied in and back out with `adb`, and every edit was diffed on the Mac.
  - The plugin loads, the toolbar opens and fits, search filters with the on-screen keyboard up, the native Group menu works, and grouping by status shows "To do".
  - A real touch swipe scrolls the grid sideways, and row lines span every column.
  - Tick, recurring completion through Tasks, status (including the custom `[?]`), priority (a new `[priority:: high]` on a Dataview line), due dates in both styles, and New task each wrote exactly the intended line.
  - Found and fixed:
    - Status, priority and date cells needed two taps: Android shows the control on focus but doesn't open its picker. On phones the picker now opens on the first tap.
    - A picked date saved only after tapping somewhere else (iPhone too). On phones it now saves as soon as the picker closes.
    - In New task, the keyboard covered **Add task**, and its action key moved to the next field. The key now says Done and adds the task.
  - Rechecked on the iPhone with these fixes: one tap still opens one native menu, and a picked date saves when you press ✓ (it wrote `📅 2026-11-24`).
