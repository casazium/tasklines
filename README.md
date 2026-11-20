# Task Rows

An Obsidian community plugin that adds a **Task rows** view to Bases: one row per inline checkbox task, with the parent note's properties as columns.

Status: milestone 1 (read-only view). See [SPIKE.md](SPIKE.md) for the API findings behind the design.

## How it works

- The base's own **filters** choose which notes are in scope. Its **sort** orders notes, and its **Group by** groups them by a note property.
- The columns you pick in the base's **Properties** menu (for example `status`, `owner`) appear on every task row from that note.
- Task-level settings are in the view's config menu: hide completed, text filter, sort tasks within a note, group tasks (by the base's grouping, note, section, status, due bucket or priority), and which task columns to show.
- Click a task to open its note at that line. Cmd/Ctrl-click opens it in a new tab.

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

## Known limits (milestone 1)

- Read-only: ticking tasks arrives in milestone 3.
- Rendering is capped at 2,000 rows until virtualized rendering lands in milestone 2.
- Task fields cannot appear in Bases' own filter, sort or group menus. The Bases API only allows note, file and formula properties.

## Development

```bash
npm install
npm run build   # type-check (src and tests) and bundle to main.js
npm test        # parser fixtures, extraction and sort tests
npm run lint
```

Parser fixtures live in `tests/fixtures/task-lines.json`. Add one for every parsing bug found.

`test-vault/` has the plugin installed. Open it in Obsidian 1.10 or newer and open `Project tasks.base`.
