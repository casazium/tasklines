# Task Rows

An Obsidian community plugin that adds a **Task rows** view to Bases: one row per inline checkbox task, with the parent note's properties as columns.

Status: milestone 2 (filter, sort, group; still read-only). See [SPIKE.md](SPIKE.md) for the API findings behind the design.

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

## Known limits (milestone 2)

- Read-only: ticking tasks arrives in milestone 3.
- Task fields cannot appear in Bases' own filter, sort or group menus. The Bases API only allows note, file and formula properties. That's why the task toolbar exists.
- Rows have a fixed height. Long task text and multi-value properties are cut off with an ellipsis, and the full text is in the tooltip.
- Sorting and grouping by a note property use the value's displayed text, compared with numbers in natural order (`9` before `10`).

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
