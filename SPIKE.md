# Spike findings: Task rows for Bases (milestone 0)

Nov 20, 2026. Sources: `obsidian@1.14.4` typings (`obsidian.d.ts`), the [Bases view guide](https://docs.obsidian.md/plugins/guides/bases-view), and the spike code in `src/`.

**How this was checked:** Obsidian is not installed on the machine used for the spike. The spike view type-checks, lints and bundles, and the parser passes its fixture tests. **It has not been run inside Obsidian yet.** Answers below that rely on the type definitions are marked *(typings)*. Answers that still need a check in the running app are marked *(verify in app)*.

## Answers

| # | Assumption | Answer | Confidence |
| --- | --- | --- | --- |
| 1 | Entry data access | **Yes.** Each entry is a `BasesEntry` with `file: TFile` and `getValue(propertyId)`, which works for `note.*`, `file.*` and `formula.*` ids. | High *(typings + guide)*. Cost at scale: *verify in app* |
| 2 | Native filter UI | **No.** `BasesPropertyType` only allows `'note' \| 'formula' \| 'file'`, and there is no API to register properties or functions. Task fields cannot appear in the native filter, sort or group menus. | High *(typings)* |
| 3 | View options | **Partly.** Options are fine for saved settings but too limited for a filter bar. | High *(typings)* |
| 4 | Cache scope | **Yes.** `ListItemCache.task` is the status character (or `undefined` for a list item that is not a task), and `position.start.line` gives the line. Files with no tasks are skipped without being read. The text of each task still needs one `cachedRead` per file. | High *(typings)*. Callout and nested-blockquote coverage: *verify in app* |
| 5 | Version floor | **`minAppVersion: 1.10.0`.** Everything the spike uses is `@since 1.10.0`. | High *(typings)* |
| 6 | Tasks plugin coexistence | **Reading is safe; writing completion marks needs a design change.** See below. | Medium. *Verify in app* |

### 1. Entry data access

- The native **Properties** toolbar menu already sets the inherited columns. `config.getOrder()` returns the ids the user picked, and `config.getDisplayName()` returns their labels, renames included. The spike shows those after its fixed task columns. Users don't need a separate column picker for note properties.
- `Value.renderTo(el, app.renderContext)` renders links, tags, dates and images the same way the native table does.
- The guide says Bases recreates `data` and every `BasesEntry` on each update. The spike copies the values it needs into a plain `RowSource` at the start of `onDataUpdated()` and keeps no entry objects between updates.
- Not yet measured: the cost of `getValue` × visible columns × several thousand notes. The guide only says views must cope with "thousands of entries".

### 2. Native filter, sort and group

The base's own filter, sort and `groupBy` all work at the **note** level. That splits the work cleanly:

- **Base filters** choose which notes are in scope. This works unchanged.
- **Base sort** sets note order. `data` is already sorted, and the spike's task sort is stable, so tasks keep note order within ties.
- **Base `groupBy`** groups by note property, and `groupedData` hands those groups to the view. The spike's default group mode, "Bases Group by", reuses them, so "group by a note property" works with no extra code.
- **Task-level** filtering, sorting and grouping (status, due, priority, text) **must be in the view.** No future API is visible in the typings.

### 3. View options

Available option types: `dropdown`, `toggle`, `text`, `multitext`, `slider`, `property`, `file`, `folder` and `formula`, plus `group` (a collapsible section) and `shouldHide` for conditional options. Values are saved in the `.base` file's view entry, and the view reads them with `config.get(key)` and writes them with `config.set(key, value)`.

- **Enough for:** saved settings such as hide completed, task sort key, task group mode, which task columns to show, a default text filter, and a due window (slider).
- **Not enough for:** a multi-select dropdown (status chips, priority set). The `multitext` type is free text, not a picker. Options also live in the view's config menu, a click away, which is wrong for filters people change often.
- **Recommendation:** use **in-view controls** for quick filters (a status, due and priority toolbar above the table) and save their state with `config.set`, so presets live in the `.base` file (which is v1's "saved presets" for free). Keep `options` for settings that rarely change.
- Note: the `formula` option plus `config.getEvaluatedFormula(view, key)` (1.10.2) lets a user type a Bases formula that is evaluated against the active file, for example "tasks linking to this note" in an embedded base. Worth considering for v1. If used, `minAppVersion` goes up to 1.10.2.

### 4. Cache scope

`metadataCache.getFileCache(file).listItems` lists every item with its line and parent line, and has `task` set only for checkbox items. The spike indexer (`src/indexer.ts`):

1. Skips any file with no task items without reading it.
2. Reads files that have tasks once with `vault.cachedRead`, then parses only the cached task lines (no full scan for `- [ ]`).
3. Gets parent/subtask links from `ListItemCache.parent` and the section from `headings`.
4. Caches by path + mtime. The cache is cleared on `metadataCache` `changed` (not vault `modify`, which can fire before the list positions are updated), `rename` and `delete`.

A side benefit: the cache already leaves out checkboxes inside code blocks, which a regex scan would wrongly pick up.

To check in the app: whether tasks inside callouts (`> - [ ]`) are in `listItems`. The parser accepts the `> ` prefix in case they are.

### 5. Version floor

| API | Since |
| --- | --- |
| `registerBasesView`, `BasesView`, `BasesEntry.getValue`, `BasesViewConfig.get/set/getOrder/getSort/getDisplayName`, `Value.renderTo`, `App.renderContext`, text, toggle and dropdown options | 1.10.0 |
| `file`/`folder`/`formula` options, `getEvaluatedFormula`, `createFileForView` | 1.10.2 |
| `groupOrder` in the view config | 1.14.3 |

The manifest is set to `minAppVersion: "1.10.0"` and `versions.json` maps `0.0.1 → 1.10.0`.

### 6. Tasks plugin coexistence

- **Reading:** no conflict. The plugin only reads files and never touches the editor.
- **Writing:** if the plugin flips `[ ]` to `[x]` itself through `Vault.process`, Tasks' own completion logic does not run. That means no `✅` done date, no next recurrence and no custom status transitions. Recurring tasks would be completed wrongly. **Proposed change:** when Tasks is enabled, ask its public API for the replacement line(s). As I recall, Tasks has `apiV1.executeToggleTaskDoneCommand(line, path)`, which returns the new text. Write that text with `Vault.process` after the usual line check. Use the plugin's own toggle only when Tasks is not installed. *(Confirm the API name and behavior against the installed Tasks version.)*
- **Editor clash:** if the note is also open in an editor, `Vault.process` is atomic at the file level, but the open editor reloads. The "re-read and verify the line" rule still holds. Check that the cursor and undo history behave well *(verify in app)*.

## Other findings

- **Body-only edits might not trigger a refresh.** If a user ticks a task in the editor, the note's properties don't change. It is not documented whether Bases calls `onDataUpdated` for changes to the note body only. If it doesn't, the view shows stale tasks. Fallback for milestone 1: the view listens to `metadataCache` `changed` itself and re-renders when the file is one of its current notes. **This is the most important thing to test in the app.**
- **Rendering at 10k tasks:** the guide asks views to reuse DOM and skip rows that are off screen. The spike caps output at 2,000 rows. Milestone 2 needs a virtualized list to meet the 10,000-task check.
- **Parser speed:** 10,000 task lines parse in about 55 ms in Node (`npm test`), so parsing is not the bottleneck. File reads and `getValue` calls are what need benchmarking.
- **Lint:** the `obsidianmd` sentence-case rule flags "Bases" in a notice. Kept as is, because Bases is the feature's name.

## Recommended scope changes

1. **Drop "task fields in Bases' native filter UI" for good.** Plan for: native filters choose notes, native sort and group handle note fields, and an in-view toolbar handles task fields.
2. **Inherited columns come from the native Properties menu.** The MVP's column picker only needs to cover task columns, using one `multitext` or a set of toggles.
3. **Saved presets move from v1 into the MVP.** They are almost free: in-view controls save their state with `config.set`, which writes it to the `.base` file.
4. **Write-back hands completion to the Tasks API when Tasks is installed**, rather than "defer recurrence later". Without this, ticking a recurring Tasks-format task gives the wrong result in the MVP.
5. **Add a refresh test to milestone 1:** the view updates after a body-only edit.
6. **Virtualized rendering belongs in milestone 2**, not later.
7. Before milestone 1, install and look at the direct competitor [Bases Task Rows](https://community.obsidian.md/plugins/bases-task-rows) to confirm how it differs.

## Spike contents

- `src/bases-adapter.ts`: the only file that calls the Bases API (view registration, `BasesView` subclass, entry snapshots, `renderTo`, jump to line).
- `src/indexer.ts`: the per-file task cache built on the metadata cache.
- `src/parser.ts`: Tasks emoji, Dataview inline fields, custom statuses, tags, numbered and blockquote lists.
- `src/view.ts`: table rendering, task-level filter, sort and group.
- `tests/parser.test.ts`: 7 fixture and throughput tests (`npm test`).
- `test-vault/`: three notes and `Project tasks.base`, grouped by `note.area` with `status` and `owner` columns.

To try it, copy `main.js`, `manifest.json` and `styles.css` into `test-vault/.obsidian/plugins/task-rows/`. Open `test-vault` in Obsidian 1.10 or newer, enable the plugin, and open `Project tasks.base`.
