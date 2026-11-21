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

## Themes

Run on 2026-11-20 in Obsidian 1.15.1 (macOS) with `perf-vault/theme-check.js` (not committed), which measures row height, clipped cells, checkbox size and position, header alignment, toolbar overflow and the cell editor's fit. Five themes, each in light and dark, at desktop width and with `app.emulateMobile(true)`: the default theme, Minimal 9.1.4, AnuPpuccin 1.5.0, Things 2.2.6 and Blue Topaz (2026110301). I also looked at each one.

- [x] Rows keep their fixed height (30 px, 40 px on touch), nothing is clipped, checkboxes stay inside their rows, header columns line up with the cells, the toolbar fits, and the cell editors fit their cells, in all 20 combinations.
- [x] Checkbox states follow the theme (Minimal's circles, a dash for cancelled in Minimal and Things).
- [x] Found and fixed: Blue Topaz removed the gap between the checkbox and the task text. The gap now comes from the cell (`gap`), and the checkbox's own margin is reset, so a theme's checkbox margins can't close or widen it.

## Tasks plugin settings

Run on 2026-11-20 with Tasks 8.6.0 in the test vault. For each setting, a fresh note with plain, tagged, recurring, scheduled-recurring and in-progress tasks was ticked through the Tasklines view, and the note was diffed after each tick.

- [x] **Defaults:** one-off tasks get ✅; recurring tasks get their next occurrence above; in progress → done.
- [x] **Set created date:** the next occurrence gets ➕ (Tasks' own behaviour). Tasklines' New task does not add ➕.
- [x] **Done date off:** completions have no ✅, as in the editor.
- [x] **Next occurrence on next line:** the new occurrence goes below the completed one.
- [x] **Remove scheduled date on recurrence:** the next occurrence has no ⏳.
- [x] **Custom status cycle (To do → In progress → Done):** ticking moves a task to `[/]`, as clicking it in the editor does.
- [x] **Global filter `#task`** (also with "remove global filter" on): tagged tasks complete as usual. An untagged one-off is toggled the way Tasks toggles a plain checkbox (no ✅).
- [x] Found and fixed: an untagged **recurring** task was completed without its next occurrence, because Tasks treats a line without the global filter as a plain checkbox. Tasklines now refuses it, changes nothing and explains why (add the filter to the line, or complete it in the note).

## Windows

Run on 2026-11-20 on a Windows 11 test PC with Obsidian 1.15.1 (installed with winget) and Tasklines 0.9.7, driven over the Chrome DevTools Protocol from an SSH session. The test vault included a copy of Beta.md saved with Windows (CRLF) line endings, and the note was diffed on the Mac afterwards.

- [x] The plugin loads, the view renders with the Windows title bar, and grouping, the toolbar and the stats line work.
- [x] On the CRLF note: tick (✅ added), recurring completion through Tasks (next occurrence above), due date (Enter), priority and status edits each changed only their line. Every line kept CRLF, Tasks' two-line output was joined with CRLF, no bare LF appeared, and the file still ends with CRLF.
- [x] A Dataview-format recurring task with Tasks in emoji mode was refused, and the note was unchanged.
- [x] **On the visible desktop** (rerun the same day in the casaz Remote Desktop session with 0.9.9, Obsidian started there by a one-off scheduled task):
  - The refusal notice appears with its text, and the note is unchanged.
  - **Open at line** opens the note with the cursor on the refused task.
  - The New task window opens with the cursor in the text box. Both **Add task** and Enter add the task, with a 📅 date where given, and the window closes.
  - The Tasklines settings tab renders in Obsidian's separate Settings window.
- Note: Obsidian itself rewrites a note to LF line endings when it opens the note in its editor. Tasklines keeps CRLF in notes that are not open in the editor. Obsidian's `vault.adapter.read` also reports CRLF as LF, so line endings must be checked on disk.

## Fuzz testing

`tests/fuzz.test.ts` generates random task lines and notes and checks the write-back rules: a tick, an edit or a new task changes only its own line, every line ending survives, the line stays a task in its own format, inline code is never touched, an edit reads back as set, and tick-then-untick restores the line. `npm test` runs 3,000 cases. On 2026-11-20 it ran 200,000 cases on each of six seeds (1.2 million lines) with no failures.

Found and fixed (each one is now a fixture or an edit check):
- A block ID right after the checkbox (`- [ ] ^id`) was read as text by the parser but treated as a block ID by edits.
- A bare 🔁 directly before a Dataview field took the field as its repeat rule, so an unticked task kept a stale `[completion:: …]`.
- A repeat rule ran on into inline code that followed it.
- A bare 🔁 followed by another emoji became an empty repeat rule, so ticking such a task was refused.
- Edits on lines with repeated or competing fields (two priorities, a date in both styles, a repeat rule that ended at the field being changed) could leave the line reading differently. Every edit now checks that the line reads back as asked, with the description and repeat rule unchanged, and refuses otherwise. Clearing a date removes every copy of it.
- New task refuses text that would not read back with the chosen due date or priority (for example a 🔁 typed into the text).

## Accessibility

Run on 2026-11-20 in Obsidian 1.15.1 (macOS) with axe-core 4.10.3 (run from the developer console, not committed) and a keyboard-only pass logged with a focus listener.

- [x] **axe-core:** no violations on the view, with the toolbar open and with a cell editor open. Before the fixes it reported a missing table role (critical), an unlabelled cell dropdown (critical) and low contrast on active chips and the New task button (serious).
- [x] **Keyboard:** Tab and Shift+Tab move through checkbox, task link and each editable cell in order. Space ticks and reopens a task. Enter opens a cell's editor, Enter saves and Escape cancels, and focus returns to the cell. After a tick or an edit redraws the list, focus stays on the same control of the same task, even when the task moves to a new position.
- [x] Checkboxes and task links show a clear focus ring.
- Found and fixed:
  - The grid now has `role="table"`, a full `aria-rowcount` and `aria-rowindex` on each drawn row (only on-screen rows exist). Group headings are rows with a row header.
  - Cell editors are labelled ("Priority for Fix gate"), and the 🔁 marker is announced as "Repeats every week".
  - Focus was lost to the page after every redraw. The list now restores it by task and control.
  - The Enter that saved a cell editor reached the cell and reopened the editor.
  - Active chips and the New task button use a darker accent so small text meets 4.5:1 contrast.
- [ ] Not covered: listening with VoiceOver or NVDA. The roles and labels follow the ARIA table pattern, but a screen-reader pass is still worth doing.

## Upgrade and downgrade

Run on 2026-11-20 in Obsidian 1.15.1 (macOS) with the published 0.9.0 and 0.9.9 release files, swapped into the test vault from the developer console.

- [x] **Formats unchanged since 0.9.0:** the settings fields, the view options stored in `.base` files (`taskQuery`, `showToolbar`, `taskCol_…`), the saved filter's shape and the code that reads it back (`normalizeQuery`) are identical in 0.9.0 and 0.9.9.
- [x] **0.9.0 → 0.9.9 → 0.9.0:** 0.9.0 saved non-default settings (completion date off, Tasks off, Dataview fields, an extra custom status, an excluded folder) and a customised view (Done and High chips, tag filter `#work`, group by status). After the upgrade, and again after downgrading, the settings, the saved filter, the active chips, the sort and group menus and the tag filter were identical. Neither version rewrote the other's `data.json` or `.base` file, and no errors were logged.
- The stats line differs only where 0.9.1 changed how notes are counted, by design.

## Soak test (memory and listeners)

Run on 2026-11-20 in Obsidian 1.15.1 (macOS) in the perf vault (5,000 notes) with 0.9.9, from the developer console. Measured after each batch: live change listeners, cached notes, Tasklines views, rows and page elements, and JavaScript heap.

- [x] **300 opens and closes of the base:** 0 listeners and 0 views afterwards, and page elements back to the starting count.
- [x] **2,000 note edits with a view open:** 1 listener, 1 view and the same number of rows and elements throughout.
- [x] **200 notes created, renamed and deleted with a view open:** the cache stayed at one entry per note (deleted and renamed paths dropped).
- [x] **Heap** rose and fell with garbage collection (79–166 MB) and ended at 85–101 MB, with no steady climb.
- [x] **Plugin turned off and on 30 times with a view open:** the open view keeps the old code until closed (a known Bases behaviour), but nothing accumulates. Closing it returns to the starting state, and a fresh view has exactly 1 listener.

## Oldest supported Obsidian

`manifest.json` declares `minAppVersion` 1.10.0. The oldest public 1.10 release is 1.10.3 (1.10.0 to 1.10.2 were early-access builds). Run on 2026-11-20 on the Windows 11 test PC with Obsidian 1.10.3 (official installer, version confirmed from the running app) and Tasklines 0.9.9, driven over the Chrome DevTools Protocol. No errors or exceptions were logged.

- [x] The plugin and the Tasks plugin load. The view renders with its columns, table semantics and stats line.
- [x] Tick, recurring completion through Tasks (next occurrence above), and due date (Enter), priority and status edits each changed only their line, and the CRLF note kept CRLF throughout.
- [x] Toolbar: the Done chip and group by status work.
- [x] Newer calls used by Tasklines (the cross-window `instanceOf()`, run on every redraw) exist in 1.10.3. `showPicker()` is only called on phones and is guarded.
- Not covered on 1.10.3: notices and modals (off-screen session). They use the same Obsidian APIs as on 1.15.1.

