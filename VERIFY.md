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

## Oldest supported Obsidian for the board (1.13)

From 1.0.3 `minAppVersion` is 1.13.0. The oldest public 1.13 release is 1.13.4 (1.13.0 to 1.13.3 were early-access builds).

Run on 2026-11-21 on macOS with the official `Obsidian-1.13.4.dmg`, signed by Dynalist Inc. and notarized. It ran from the mounted image with its own `--user-data-dir`, on a copy of `test-vault/`, with Tasklines from `main` (1.1.1 plus the unreleased accessibility fixes) and Tasks 8.6.0. It was driven over the DevTools protocol, and the version was confirmed from the running app. Nothing was logged as an error.

- [x] Both plugins load. The three board views render with the right columns, which shows the view's **Columns** dropdown is read correctly. The list view renders with its table, and the board hides the toolbar's group control.
- [x] Moves each wrote exactly one intended line:
  - To do to In progress.
  - Done to Cancelled (`❌ <today>`).
  - A recurring task to Done (completed by Tasks, next occurrence above).
  - Overdue to Today.
  - Later to No due date (field removed).
  - Medium to Highest (🔺 before `^beta-block`).
- [x] Drops onto the card's own column and onto Later were refused.
- [x] After a move, the live region announced it ("Moved "Write announcement" to In progress.").
- [ ] Not confirmed on 1.13.4: the **Undo** notice. No notice appeared, but Obsidian's own `new Notice('…')` didn't appear either. A separate Settings window had opened on first launch and held focus, so this looks like Obsidian not showing notices in an unfocused window, not a Tasklines problem. `Notice` and the `DocumentFragment` helpers Tasklines uses exist in 1.13.4. The test was cut short before the window could be focused.
- The download, the mounted image and the vault copy were removed afterwards.

## Declarative settings (1.0.3)

From 1.0.3 the settings tab uses `getSettingDefinitions()` (Obsidian 1.13+) and `minAppVersion` is 1.13.0. Checked on 2026-11-20 in Obsidian 1.15.1 (macOS), after quitting Obsidian so the Settings window loaded the new code:

- [x] Settings search finds Tasklines' settings ("excluded folders", "completion date") and jumps to them.
- [x] The tab shows the three headed groups, the format dropdown, the wide statuses box with its reset button, and the excluded-folders box.
- [x] Each control saves: the completion-date toggle writes `auto`/`off`, the Tasks toggle writes `true`/`false`, and excluded folders saves its text. An invalid status line shows its warning as you type, and the reset button restores the defaults and clears it.
- [x] Lint reports no warnings.
- Obsidian 1.10 to 1.12 keep 1.0.2 through `versions.json`.


## Task board

Checked on 2026-11-21 in Obsidian 1.15.1 (macOS), with the Tasks plugin enabled, using `test-vault/Task board.base`. Drags were sent as DOM drag events from the developer tools protocol. macOS shows Obsidian menus as native menus, so the card menu was opened on screen and its items were then run from the menu object.

- [x] Status board: To do, In progress, Done and Cancelled columns. Dragging a card writes one line and moves the card. Dropping on its own column is refused while dragging.
- [x] Undo in the notice restored the exact line (Dataview style, tab indent).
- [x] Card menu: "Move to To do" was disabled for a to-do card, and "Move to Done" added `✅ <today>`. Keyboard focus followed the card, and the live region announced the move.
- [x] A note changed during a drag (which redraws the board), and the drop still landed.
- [x] A recurring task dragged to Done was completed by Tasks: next occurrence above, done line below.
- [x] Cancelling a recurring Tasks-style task added `❌ <today>`.
- [x] Due-date board: Overdue, Next 7 days and Later are dashed, show their explanations, and refuse drops. Today and Tomorrow set the date, and No due date removes it.
- [x] Priority board: dropping on High added ⏫ to a task inside a callout.
- [x] Failure cases (2026-11-21, same setup). Each was refused with a notice, and the note was left as it was:
  - The note changed while its card was being dragged. The drop was refused with "The task line changed since the view was drawn", and the later edit was kept.
  - Undo after the line was edited again was refused the same way. The move and the later edit were both kept.
  - A cancelled recurring task dropped on Done got the "Reopen it first" message.
  - The Tasks plugin was replaced with a stand-in that returns In progress, then a recurring task was dropped on Done. It was refused with "would move this task to a status other than done". The Tasks API is a getter that returns a new object on each read, so the stand-in has to be set on the plugin instance (`Object.defineProperty`), not on `apiV1`.
- [x] Performance (2026-11-21, `perf-vault`, 5,008 notes, 10,512 tasks, Obsidian 1.15.1 on an M-series Mac):
  - The status board opened in 115 ms; the list view of the same vault took 148 ms. Each column draws 100 cards, about 1,900 DOM nodes in all.
  - Each "Show more" redraws the whole board: 17 ms with 300 cards on screen, rising to 42 ms with 900. Changing a note showed on the board 126 ms later.
  - The due-date board opened in 115 ms.
- [x] **Android** (2026-11-21, Android Studio emulator, API 37, Obsidian 1.15.1, Tasks enabled). The vault was copied in and out with `adb`, and the notes were diffed on the Mac afterwards: every change was exactly one intended line.
  - Columns are most of the screen wide with the next one peeking in, and the toolbar folds into "Filter, sort (N)".
  - The **⋯** menu opens as Obsidian's bottom sheet, with the card's own column disabled. On the due-date board it lists only Today, Tomorrow and No due date.
  - Menu moves worked:
    - To do to In progress.
    - In progress to Done, which added `[completion:: …]`, and **Undo** in the notice put the line back exactly.
    - Overdue to Tomorrow.
    - Medium to Highest, kept before `^beta-block`.
  - A recurring task moved to Done from the menu was completed by Tasks, with the next occurrence above it and no Undo offered.
  - Unticking a done card reopened it and removed its ✅ date.
  - Found and fixed:
    - After a menu move, focus followed the card by focusing its **⋯** button. That scrolled the board only as far as the button, which left columns half off screen. The whole column and card are now scrolled into view first.
    - On phones a sideways swipe could also stop between columns. It now settles on a whole column (scroll snap).
    - The Undo notice now stays 8 seconds instead of 6, to give time to reach it on a phone.
    - Found while checking the scrolling fix on desktop: ticking a checkbox, in the board or the list, dropped keyboard focus to the page. The checkbox was disabled while the change was saved, and Obsidian 1.15.1's Chromium moves focus away from a disabled element. It is now marked busy (`aria-disabled`) instead. Focus stays on the checkbox and follows the task after the redraw, which the accessibility check above expects.
  - Not a Tasklines problem: the emulator's Play Store updated Android WebView in the background, and Android closed Obsidian for the update (`killDueToPackageUpdate` in the device log).
- [x] **Real mouse drag** (2026-11-21, macOS, Obsidian 1.15.1, with the real pointer through computer use). A background drag can't start a macOS drag session, so this needs Obsidian in front.
  - While dragging, Obsidian's preview of the card follows the pointer, the original card dims, and the target column gets an accent outline. The outline stays while the pointer is over a card in that column.
  - Dropping on another column wrote one line ("Confirm catering" to In progress), and a real click on **Undo** restored a later move.
  - Dropping on the card's own column did nothing.
  - Dropping a card into an open note in a split pane inserted nothing and changed nothing. The editor sees the drag, but the card carries only Tasklines' own drag type.
  - Found and fixed: hovering anywhere on a card showed its column's name as a tooltip, and hovering a list row showed "Tasks". Obsidian shows any `aria-label` as a tooltip, and the card lists and the table were named that way. They are now named with `aria-labelledby` (the column title, and a hidden "Tasks" label), so the names are kept and the stray tooltips are gone. Controls such as checkboxes still show their own tooltips.
- [x] **iPhone** (2026-11-21, Obsidian 1.15.1 for iOS, Tasks enabled, driven through iPhone Mirroring). The vault was reset over iCloud to the original notes and the build from `main` (1.1.1 plus the tooltip fix). Obsidian was reloaded once the files had synced, and the run started from the original counts (14 open, 4 overdue, 1 done). Afterwards every note was diffed on the Mac: each change was exactly one intended line, and the notes kept their final newline.
  - Columns are most of the screen wide with the next one peeking in, and the toolbar folds into "Filter, sort (N)".
  - The **⋯** menu opens as the iOS bottom sheet, with the card's own column disabled. On the due-date board it lists only Today, Tomorrow and No due date.
  - Menu moves:
    - To do to In progress.
    - In progress to Done, and **Undo** put the line back.
    - Done to Cancelled swapped ✅ for ❌, and Cancelled to To do removed the ❌.
    - Overdue to Tomorrow.
    - Tomorrow to No due date removed the `[due:: …]` field.
    - High to Highest (⏫ to 🔺).
  - After each move the board scrolled the card's whole column into view.
  - A recurring task moved to Done was completed by Tasks, with the next occurrence above it and no Undo offered. Ticking a card's checkbox added `✅ <today>`.
  - The Overdue column shows its dashed border and explanation.
  - iOS doesn't focus a tapped checkbox, so after ticking, the board stays where it is rather than following the card. That's fine on a phone.
  - Not covered: swiping between columns, because iPhone Mirroring doesn't pass mouse drags or scrolling through as touch swipes. Arrow keys from a hardware keyboard scroll the board, but WebKit doesn't snap keyboard scrolling to columns. Swipe snapping was checked on Android.
  - Obsidian for iOS rewrote `Project tasks.base` in its own format when it opened it, as desktop Obsidian does. Tasklines doesn't write that file in these tests.
- [x] **Accessibility tree** (2026-11-21, Obsidian 1.15.1 on macOS, read through the developer tools protocol with `Accessibility.getFullAXTree`, the roles and names VoiceOver uses):
  - Board: each column is a level-3 heading ("To do 13 tasks") followed by a list named by its title (`aria-labelledby`). Each card is a list item with:
    - a checkbox ("Complete: Fix gate", "Reopen: …" when done, mixed when in progress);
    - a link ("Fix gate — open Projects/Beta.md at line 6");
    - a "Move: Fix gate" button with `hasPopup=menu`;
    - named icons ("high priority", "Repeats every week").
  - List view: a table named "Tasks" (`aria-labelledby`) with column headers. Group rows have the group as a row header, and editable cells are labelled "Edit due: 2026-11-30".
  - After a move, the polite, atomic live region reads "Moved "Confirm catering" to In progress.".
  - Found and fixed:
    - An overdue date on a card was shown only in red. It now carries hidden text, "(overdue)".
    - The column count was named with `aria-label` ("13 tasks"), which Obsidian shows as a tooltip. It now uses hidden text, and the heading still reads "To do 13 tasks".
- [x] **VoiceOver** (same day, partial, the user listening while Claude pressed the keys):
  - Tabbing from the To do heading read the first card's checkbox as "Complete: Fix gate, unchecked, checkbox", then its link with the note and line, then "Move: Fix gate" as a menu button.
  - The pass stopped before moving a card from the menu. The announcement is covered by the live-region check above.
  - The first attempts heard nothing, because VoiceOver's Quick Start window, which opens the first time VoiceOver is switched on, kept VoiceOver's attention.
- [ ] Not covered: hearing VoiceOver read a move and the column headings, and NVDA on Windows.
- Known limit: **Undo** lives in Obsidian's notice, which keyboard and screen-reader users can't easily reach before it closes after 8 seconds. Undo is a convenience: a move can always be made again in the other direction.
