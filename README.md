# Tasklines

An Obsidian community plugin that adds a **Tasklines** view to Bases: one row per inline checkbox task, with the parent note's properties as columns.

Status: MVP code complete (milestones 0–3). Not yet checked inside Obsidian; see [VERIFY.md](VERIFY.md). See [SPIKE.md](SPIKE.md) for the API findings behind the design.

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
- **With the Tasks plugin (7.2.0 or later)** the plugin asks Tasks for the new line, so recurrence, done dates and custom statuses follow your Tasks settings. Completing a recurring task inserts the next occurrence just as Tasks does in the editor.
- **Without the Tasks plugin,** completing a **recurring** task is refused with a notice, because creating the next occurrence correctly is Tasks' job. Unticking still works.
- In-progress and custom statuses complete to `[x]`. Done and cancelled reopen to `[ ]`.

Settings (**Settings → Tasklines**): turn the completion date on or off, and choose whether to use the Tasks plugin.

## Known limits

- Task fields cannot appear in Bases' own filter, sort or group menus. The Bases API only allows note, file and formula properties. That's why the task toolbar exists.
- Only completion can be changed from the view. Editing dates, priority or text, adding tasks and bulk edits are planned for v1.
- Rows have a fixed height. Long task text and multi-value properties are cut off with an ellipsis, and the full text is in the tooltip.
- Sorting and grouping by a note property use the value's displayed text, compared with numbers in natural order (`9` before `10`).
- In files with old Mac line endings (CR only), write-back may refuse to change a task if Obsidian numbers the lines differently. It never writes to the wrong line.

## Development

```bash
npm install
npm run build   # type-check (src and tests) and bundle to main.js
npm test        # parser fixtures, extraction and sort tests
npm run lint
npm run bench   # index and query timing on a synthetic vault (NOTES=8000 npm run bench)
```

Parser fixtures live in `tests/fixtures/task-lines.json`. Add one for every parsing bug found.

`test-vault/` has the plugin installed. Open it in Obsidian 1.10 or newer and open `Project tasks.base`.
