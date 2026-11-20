# Tasklines

An Obsidian community plugin that adds a **Tasklines** view to Bases: one row per inline checkbox task, with the parent note's properties as columns.

Status: v1 features (milestone 4) on branch `m4/v1-features`. Not yet checked inside Obsidian; see [VERIFY.md](VERIFY.md). See [SPIKE.md](SPIKE.md) for the API findings behind the design.

## How it works

- The base's own **filters** choose which notes are in scope, so note-property filters (`owner is Bob`, `file.inFolder(...)`) use the normal Bases filter menu. The base's **sort** orders notes, and its **Group by** groups them.
- The columns you pick in the base's **Properties** menu (for example `status`, `owner`) appear on every task row from that note.
- The **task toolbar** above the rows filters, sorts and groups tasks:
  - Filter by status, priority, due date (overdue, today, next 7 or 30 days, has or has no due date, or a date range), tags (`#area` also matches `#area/home`) and task text.
  - Sort by up to three keys, each ascending or descending. Keys are any task date, priority, status, text, note name, base order, or any note property. Tasks with no value always sort last.
  - Group by the base's grouping, note, section, status, due bucket, priority, tag, or any note property.
  - The toolbar's state is saved in the `.base` file under the view's `taskQuery` key, so each view is a saved preset. **Reset** clears it.
- The view's config menu has **Show task toolbar** (turn it off for embedded bases) and switches for each task column.
- Click a task to open its note at that line. Cmd/Ctrl-click opens it in a new tab.
- **Tick the checkbox** to complete or reopen a task in its note (see below).
- **Click a Status, Due, Scheduled, Start or Priority cell** to edit it in place. The change is written in the style the line already uses.
- **New task** adds a task to any note in the base, after that note's last task.
- **Computed columns** (switch them on in the view's config menu): Overdue, Days until due, Age, Subtasks done, Note progress.
- Group headers and the line above the table show open, overdue and done counts.
- **Completed-task window:** show completed tasks from today, the last 7 days or the last 30 days only.
- Only the rows on screen are drawn, so large lists scroll smoothly.

## Supported task syntax

Any list item Obsidian recognizes as a task (`-`, `*`, `+` or numbered list, any status character, including inside block quotes).

| Field | Tasks plugin emoji | Dataview inline field |
| --- | --- | --- |
| Due | `📅` `📆` `🗓` | `[due:: 2026-01-01]` |
| Scheduled | `⏳` `⌛` | `[scheduled:: …]` |
| Start | `🛫` | `[start:: …]` |
| Created | `➕` | `[created:: …]` |
| Done | `✅` | `[completion:: …]` |
| Cancelled | `❌` | `[cancelled:: …]` |
| Priority | `🔺` `⏫` `🔼` `🔽` `⏬` | `[priority:: high]` |
| Recurrence | `🔁 every week` | `[repeat:: every week]` |
| ID / depends on / on completion | `🆔` `⛔` `🏁` | |

Also read: `#tags`, `[[wikilinks]]`, a trailing `^block-id`, any other `[key:: value]` or `(key:: value)` field, the nearest heading (Section) and subtask nesting. Text in `inline code` is never read as metadata. Checkboxes inside code blocks are ignored.

## Completing tasks from the view

Ticking a checkbox changes only that task's line in the note, through Obsidian's atomic `Vault.process`:

- **Safety first.** Before writing, the plugin re-reads the note and checks that the line is exactly what the view showed. It checks again inside the atomic write. If anything differs (you edited the line, it moved, the note was renamed), nothing is written, you get a notice, and the view refreshes.
- **Keeps your format.** Only the status character changes, plus a completion date in the format the line already uses: `✅ 2026-11-20` for Tasks-style lines, `[completion:: 2026-11-20]` for Dataview-style lines. A date goes before a trailing `^block-id`. Line endings (LF or CRLF) are preserved. Unticking removes the date.
- **With the Tasks plugin (7.2.0 or later)** the plugin asks Tasks for the new line, so recurrence, done dates and custom statuses follow your Tasks settings. Completing a recurring task inserts the next occurrence just as Tasks does in the editor. This works for emoji lines and, when Tasks is set to its Dataview format, for `[repeat:: …]` lines too.
- **Tasks reads one format at a time.** If Tasks is set to the emoji format and the line uses Dataview fields (or the other way round), Tasks can't see the line's fields. Tasklines notices this and never writes the mixed result. A one-off task is completed by Tasklines itself in the line's own style. A recurring one is refused, so the next occurrence is never lost.
- **Without the Tasks plugin,** completing a **recurring** task is refused, because creating the next occurrence correctly is Tasks' job. Recurring tasks show 🔁 next to their text, and their checkbox explains this before you click. Unticking still works.
- Every refusal notice has an **Open at line** button, so the task is one click from the editor.
- In-progress and custom statuses complete to `[x]`. Done and cancelled reopen to `[ ]`.

Settings (**Settings → Tasklines**):
- Turn the completion date on or off, and choose whether to use the Tasks plugin.
- **Style for new fields on plain tasks:** when you set a date or priority on a task with no metadata, use Tasks emoji (`📅 2026-01-31`) or Dataview fields (`[due:: 2026-01-31]`). Tasks that already have a style keep it.
- **Task statuses:** one per line, `character | name | kind`, where kind is `todo`, `in-progress`, `done`, `cancelled` or `other`. Names appear in the Status column and editor. Space, `x` and `-` always mean to do, done and cancelled.
- **Excluded folders:** notes in these folders are never indexed (for example `Templates`).

## Editing and adding tasks

Editing a cell follows the same rules as ticking: the line must still match what the view showed, only that line changes, and a mismatch is refused with a notice.

- A date or priority the line already has is changed **where it is**, keeping its emoji variant or field brackets. A new one goes at the end of the line, before any `^block-id`. Text in `inline code` is never touched.
- Setting the status to a done status adds a completion date; leaving done removes it.
- **New task** inserts exactly one line after the note's last task (and after any bullets nested under it), in the same style and inside the same callout. A note without tasks gets the task at the end, after a blank line.

## Moving from Dataview

Put the cursor inside a ```` ```dataview ```` block that starts with `TASK` and run **Convert Dataview task query under cursor to a base**. Tasklines creates `<note> tasks.base` next to the note and opens it. Your note isn't changed; embed the base with `![[<note> tasks.base]]` when you're happy with it.

What gets translated:

| Dataview | Tasklines |
| --- | --- |
| `FROM "folder"`, `#tag`, `-"folder"`, `AND` / `OR` | Base filters `file.inFolder()`, `file.hasTag()` |
| `WHERE !completed` / `completed` / `status = "/"` | Status filter |
| `due < date(today)`, `= date(today)`, `<= date(today) + dur(7 days)` (or 30), `due >= date(2026-01-01)` | Due filter: overdue, today, next 7/30 days, date range |
| `contains(text, "…")`, `contains(tags, "…")` | Text and tag filters |
| `project = "Alpha"` | Base filter `note.project == "Alpha"` |
| `SORT due ASC, priority DESC` | Up to 3 sort keys |
| `GROUP BY file.link`, `status`, `section` | Group by note, status, section |

Anything else (`OR` inside `WHERE`, `LIMIT`, `FLATTEN`, link sources, custom functions) is listed at the top of the new file to fix by hand.


## Known limits

- Task fields cannot appear in Bases' own filter, sort or group menus. The Bases API only allows note, file and formula properties. That's why the task toolbar exists.
- Task text, tags and recurrence rules can't be edited in the view yet; open the note for those. Bulk edits and drag between groups are planned for later.
- Completing a recurring task still needs the Tasks plugin.
- Rows have a fixed height. Long task text and multi-value properties are cut off with an ellipsis, and the full text is in the tooltip.
- Sorting and grouping by a note property use the value's displayed text, compared with numbers in natural order (`9` before `10`).
- In files with old Mac line endings (CR only), write-back may refuse to change a task if Obsidian numbers the lines differently. It never writes to the wrong line.

## Development

Needs Node 22.18 or newer: the tests import the TypeScript sources directly. CI builds, lints and runs the tests on Node 22 and 24.

```bash
npm install
npm run build   # type-check (src and tests) and bundle to main.js
npm test        # parser fixtures, extraction and sort tests
npm run lint
npm run bench   # index and query timing on a synthetic vault (NOTES=8000 npm run bench)
```

Parser fixtures live in `tests/fixtures/task-lines.json`. Add one for every parsing bug found.

`test-vault/` has the plugin installed. Open it in Obsidian 1.10 or newer and open `Project tasks.base`.
