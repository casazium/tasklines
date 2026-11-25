# Tasklines: notes for contributors and coding agents

Obsidian community plugin that adds a **Tasklines** view to Bases: one row per inline checkbox task, with the parent note's properties as columns. A second view, **Task board**, shows the same tasks as cards in columns (by status, priority, due date, or urgent and important), and a third, **Task calendar**, puts them on the days of their dates.

## Commands

```bash
npm ci
npm run build   # tsc (src + tests + bench) and esbuild → main.js
npm test        # node --test, needs Node 22.18+ (imports .ts directly)
npm run lint    # eslint with eslint-plugin-obsidianmd
npm run bench   # index/query timing on a synthetic vault
```

## Rules that must hold

- **Only one module calls the Bases API:** `src/bases-adapter.ts`. Other modules may import Obsidian *types* only (except `writer.ts`, `settings.ts`, `add-task-modal.ts`, `migrate-command.ts`, `folder-base-command.ts`, `debug-command.ts` and `main.ts`, which use non-Bases runtime APIs).
- **Notes change only through `Vault.process`, one line at a time.** `src/writeback.ts` and `src/edit.ts` are pure functions that compute the new content. They refuse rather than guess when the line no longer matches what was indexed. `src/writer.ts` does a precheck read and then re-verifies inside `Vault.process`. Adding a task inserts exactly one line.
- **Keep each line's format.** Edits use the style the line already has (Tasks emoji or Dataview fields). Never convert a line between formats. Never touch text inside inline code.
- **Parser fixtures are the test oracle.** Add a case to `tests/fixtures/task-lines.json` for every parsing bug. Every fixture is automatically run through the byte-safety, toggle and edit suites.
- **Obsidian's real metadata cache is the oracle for note structure.** `tests/fixtures/obsidian-cache.json` holds what Obsidian reported for the notes in `test-vault/Cache samples/`. When a bug depends on how Obsidian reads lists, headings or code blocks, add a sample note and recapture (steps in `tests/fixtures/README.md`). `tests/fake-vault.ts` is only an approximation.
- **The fuzz test guards the same rules on random lines** (`tests/fuzz.test.ts`, 3,000 cases in `npm test`). Before a release that touches the parser or write-back, run it larger, e.g. `FUZZ_CASES=200000 FUZZ_SEED=7 node --test tests/fuzz.test.ts`, and turn any failure into a fixture.
- **Mobile:** no Node APIs in `src/`, and no regex lookbehind (unsupported on iOS before 16.4). Keep `isDesktopOnly: false`.
- **Pure modules stay importable by Node:** use `.ts` import extensions, `import type` for type-only imports, and no TypeScript parameter properties in files that tests import.
- No network access, telemetry, reminders, time tracking or new task syntax.

## Layout

| File | Role |
| --- | --- |
| `src/main.ts` | Plugin entry: settings, index, writer, events, command, view registration |
| `src/bases-adapter.ts` | `BasesView` subclass, view options, snapshots of Bases entries |
| `src/parser.ts` | Task line parser, status set |
| `src/extract.ts` | Tasks from file text + metadata-cache list items (depth, section, subtasks) |
| `src/indexer.ts` | Per-file task cache keyed by mtime, invalidation listeners |
| `src/query.ts` | Task-level filter, sort, group (two levels), summaries |
| `src/tint.ts` | The views' Color option: tints and their words for screen readers (pure) |
| `src/view.ts`, `src/virtual-list.ts`, `src/toolbar.ts` | Rendering |
| `src/board.ts`, `src/board-view.ts` | Task board: columns and moves (pure), cards and drag and drop |
| `src/calendar.ts`, `src/calendar-view.ts` | Task calendar: month grid, agenda and date moves (pure), rendering |
| `src/edit.ts`, `src/writeback.ts`, `src/writer.ts` | Editing and writing back |
| `src/bulk.ts`, `src/selection-bar.ts` | Bulk actions: planning, write order and reports (pure), select mode and the action bar |
| `src/dataview-migrate.ts`, `src/migrate-command.ts` | Dataview TASK → .base |
| `src/folder-base.ts`, `src/folder-base-command.ts` | New task base for a folder: the file (pure), the command and folder menu item |
| `src/debug-info.ts`, `src/debug-command.ts` | Copy debug info: the text (pure, no note content), the command |

## Releasing

Releases are batched: merge changes to `main` through pull requests, but release only when a batch is ready and the full test pass in [RELEASE.md](RELEASE.md) has run. Don't bump the version except to release.
