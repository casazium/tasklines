# Tasklines

**Your inline tasks as rows in Obsidian Bases.** Tasklines adds a view to Bases with one row per checkbox task in the notes a base selects. Each row carries its note's properties as columns. Filter, sort and group by task or note fields, then tick, edit and add tasks without leaving the view. Your notes stay in the formats you already use: Tasks plugin emoji or Dataview fields.

> **Beta.** 0.9.x releases are for testing. Install with BRAT (below) and try it on a copy of your vault first. Please report problems on the [issue tracker](https://github.com/casazium/tasklines/issues).

<!-- Screenshots: add images from docs/screenshots/ here before 1.0.0 (see RELEASE.md). -->

## Install

**Beta (now), with BRAT**

1. Install and enable the **BRAT** community plugin.
2. In BRAT's settings choose **Add beta plugin**, enter `casazium/tasklines`, and enable **Tasklines** in **Settings → Community plugins**.

**Community plugins (from 1.0.0):** search for "Tasklines" in **Settings → Community plugins → Browse**.

**Manually:** download `main.js`, `manifest.json` and `styles.css` from a [release](https://github.com/casazium/tasklines/releases) into `<vault>/.obsidian/plugins/tasklines/`, then enable the plugin.

Requires Obsidian 1.10 or newer with the **Bases** core plugin turned on. Works on desktop and mobile.

## Quick start

1. Create a base (**New base**), or open an existing one.
2. Use the base's **Filters** to pick the notes whose tasks you want, for example notes in your `Projects` folder.
3. Add a view and choose **Tasklines** as its layout.
4. In the base's **Properties** menu, pick the note properties to show as columns (for example `status` or `owner`).
5. Use the task toolbar to filter, sort and group the tasks.

A `.base` file with a Tasklines view looks like this:

```yaml
filters:
  and:
    - file.inFolder("Projects")
views:
  - type: tasklines
    name: Open tasks
    order: [file.name, note.owner]
    taskQuery:
      statuses: [todo, in-progress]
      due: next30
      sort:
        - key: due
          desc: false
      group: prop:note.owner
```

## Using the view

- **Notes vs tasks:** the base's own filters, sort and **Group by** work on notes. The task toolbar works on tasks:
  - **Filter** by status, priority, due date (overdue, today, next 7 or 30 days, has or has no due date, or a date range), completion window (completed today, in the last 7 or 30 days), tags (`#area` also matches `#area/home`) and task text.
  - **Sort** by up to three keys, each ascending or descending: any task date, priority, status, text, note name, base order, or any note property. Tasks with no value always sort last.
  - **Group** by the base's grouping, note, section (nearest heading), status, due bucket, priority, tag, or any note property.
- **Each view is a saved preset:** the toolbar's settings are stored in the `.base` file, so each view keeps its own. **Reset** clears them.
- **Columns:** note properties come from the base's **Properties** menu. Task columns (status, dates, priority, recurrence, tags, section, line, note) and computed columns (Overdue, Days until due, Age, Subtasks done, Note progress) are switched on in the view's config menu, which also has **Show task toolbar** (turn it off for embedded bases).
- **Counts:** group headers and the line above the table show open, overdue and done counts.
- **Open a task:** click its text to open the note at that line; Cmd/Ctrl-click opens a new tab.
- **Large vaults:** only the rows on screen are drawn, and each note is read once and cached until it changes.

## Completing, editing and adding tasks

Every change follows the same safety rule. Tasklines re-reads the note and checks that the line is still exactly what the view showed. It then writes through Obsidian's atomic `Vault.process`, changing only that line. If anything differs (you edited the line, it moved, the note was renamed), nothing is written, and a notice with an **Open at line** button appears.

- **Tick a checkbox** to complete or reopen a task. A completion date is added in the line's own style: `✅ 2026-11-20` or `[completion:: 2026-11-20]`. Unticking removes it.
- **Click a Status, Due, Scheduled, Start or Priority cell** to edit it. Existing fields are changed where they are. New ones go at the end of the line, before any `^block-id`. Text in `inline code` is never touched.
- **New task** adds one line to any note in the base, after the note's last task (and anything nested under it), in the same style and inside the same callout. A note without tasks gets it at the end.

## Works with the Tasks plugin

- **Completion:** when the Tasks plugin (7.2.0 or later) is enabled, Tasklines asks it to complete tasks. Recurrence, done dates and custom status transitions then follow your Tasks settings, and a recurring task gets its next occurrence exactly as it would in the editor.
- **Formats:** Tasks reads one format at a time (emoji or Dataview). If it's set to the other format than a line uses, Tasklines never writes the mixed result. One-off tasks are completed by Tasklines itself; recurring ones are refused, so the next occurrence is never lost.
- **Without Tasks:** recurring tasks (marked 🔁) can't be completed from the view; open the note to complete them. Everything else works.

## Supported task syntax

Any list item Obsidian recognizes as a task: a `-`, `*`, `+` or numbered list item, with any status character, including inside block quotes and callouts.

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

Also read: `#tags`, `[[wikilinks]]`, a trailing `^block-id`, any other `[key:: value]` or `(key:: value)` field, the nearest heading and subtask nesting. Checkboxes in code blocks are ignored.

## Moving from Dataview

Put the cursor inside a ```` ```dataview ```` block that starts with `TASK` and run **Convert Dataview task query under cursor to a base**. Tasklines creates `<note> tasks.base` next to the note and opens it. Your note isn't changed; embed the base with `![[<note> tasks.base]]` when you're happy with it.

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

## Settings

- **Completion date** on or off, and whether to **let the Tasks plugin complete tasks**.
- **Style for new fields on plain tasks:** Tasks emoji (`📅 2026-01-31`) or Dataview fields (`[due:: 2026-01-31]`). Tasks that already have a style keep it.
- **Task statuses:** one per line, `character | name | kind`, where kind is `todo`, `in-progress`, `done`, `cancelled` or `other`. Space, `x` and `-` always mean to do, done and cancelled.
- **Excluded folders:** notes in these folders are never indexed (for example `Templates`).

## Privacy

Tasklines works entirely inside your vault. It makes no network requests, collects no data, and changes notes only when you tick, edit or add a task. Turning the plugin off leaves every note and `.base` file as plain, valid Markdown and YAML.

## Known limits

- Task fields can't appear in Bases' own filter, sort or group menus, because the Bases API only allows note, file and formula properties. That's why the task toolbar exists.
- Task text, tags and recurrence rules can't be edited in the view yet. Open the note for those.
- Rows have a fixed height. Long text is cut off with an ellipsis, and the full text is in the tooltip.
- Sorting and grouping by a note property use the value's displayed text, with numbers in natural order (`9` before `10`).
- In files with old Mac line endings (CR only), a change may be refused if Obsidian numbers lines differently. Tasklines never writes to the wrong line.

## Development

Needs Node 22.18 or newer. CI builds, lints and tests on Node 22 and 24.

```bash
npm ci
npm run build   # type-check and bundle to main.js
npm test        # parser fixtures, write-back safety and feature tests
npm run lint
npm run bench   # index and query timing on a synthetic vault
```

- [AGENTS.md](AGENTS.md): code layout and the rules every change must keep.
- [VERIFY.md](VERIFY.md): manual checks in Obsidian; `test-vault/` has material for each.
- [RELEASE.md](RELEASE.md): how to cut a release and the community-submission checklist.
- [SPIKE.md](SPIKE.md): the Bases API findings behind the design.

## License

[MIT](LICENSE) © 2026 Bob Casazza
