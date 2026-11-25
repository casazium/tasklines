# Releasing Tasklines

Every published release goes to the Obsidian community directory, which reviews it and offers it to users as an update. So release in **tested batches**, not after every change.

## When to release

- **Merge often, release rarely.** Every change goes through a feature branch and a pull request, and is merged to `main` once CI passes. Merging doesn't release anything. Changes collect on `main` until a batch is ready.
- **Release a batch** when its features are finished and the full test pass below has run on what's on `main`.
- **Release at once** only for:
  - a bug that can damage notes, or write to the wrong line;
  - an error from the directory's review that stops the plugin being installed.

  Even then, run the parts of the test pass that the fix touches.
- **Bump the version only when releasing.** The directory reads `manifest.json` on `main`, so the version there must always be a published release.

## Full test pass

Run all of this on the commit you'll tag, and note the results in [VERIFY.md](VERIFY.md):

1. **Automated:** `npm run build`, `npm test` and `npm run lint` pass. Lint must report no warnings: it uses the same `eslint-plugin-obsidianmd` rules as the directory's review.
2. **Fuzz, large run:** `FUZZ_CASES=200000 FUZZ_SEED=7 node --test tests/fuzz.test.ts`. Turn any failure into a fixture.
3. **Desktop:** the VERIFY.md sections for everything in the batch, plus a quick pass over the list view and the task board in `test-vault/`. Then check that a base opened before Tasklines loads redraws when it turns on:
   1. Open `Project tasks.base`.
   2. Turn Tasklines off in Settings → Community plugins, then reopen the base. It shows "Unknown view type: tasklines".
   3. Turn Tasklines back on. The base should redraw with its saved filters and sorting, without being reopened.
   4. Repeat with a base embedded in a note: open `Manual tests/Other languages.md` and scroll to its base. It should redraw too.

   If the batch touches dates, write-back, the Tasks plugin, or layout and styles, also run `test-vault/Manual tests/Other languages.md`, which covers Obsidian in Arabic and right-to-left layout.

   Afterwards, put the notes back (`git checkout -- test-vault/`).
4. **Android emulator:** for any change you can see or touch. Check the list, the board, editing and New task, then pull the notes back and diff them.
5. **iPhone:** for changes to touch, pickers, menus or the keyboard.
6. **Windows** (hypatia): for changes to reading or writing files, line endings, paths or the Tasks plugin.
7. **Release notes:** list what changed for users since the last release, from the merged pull requests.

## Beta builds (optional)

For a larger feature, publish a test build before the release. A version with a suffix, such as `1.2.0-beta.1`, is marked pre-release by the workflow. BRAT installs it, but the directory and Obsidian's plugin browser ignore it.

Make beta builds **on a branch, never on `main`.** This keeps the beta version out of the `manifest.json` the directory reads.

```bash
git switch -c beta/1.2.0 main
npm version 1.2.0-beta.1 --no-git-tag-version   # also updates manifest.json and versions.json
git commit -am "Beta 1.2.0-beta.1"
git push -u origin beta/1.2.0
git tag 1.2.0-beta.1 && git push origin 1.2.0-beta.1
```

Publish the draft pre-release, then install it with BRAT (`casazium/tasklines`, "Add beta plugin"). Delete the beta branch afterwards. Its version bump must not be merged.

## Cutting a release

Versions are plain `x.y.z` (Obsidian supports nothing else), and the git tag must equal the version exactly, with no `v` prefix. `.npmrc` sets `tag-version-prefix=""`.

1. On a branch, run `npm version x.y.z --no-git-tag-version`. This bumps `package.json`, `manifest.json` and `versions.json`. Also set the version in `test-vault/.obsidian/plugins/tasklines/manifest.json`. Open a pull request and merge it once CI passes.
2. On `main`, tag and push: `git tag x.y.z && git push origin x.y.z`.
3. The **Release Obsidian plugin** workflow then:
   1. fails if the tag doesn't match `manifest.json`, `package.json` and an entry in `versions.json`;
   2. builds, lints and runs the tests;
   3. attests build provenance for `main.js` and `styles.css`;
   4. creates a **draft** GitHub release with `main.js`, `manifest.json` and `styles.css`, and generated notes. Versions `0.x` and `x.y.z-…` are marked **pre-release**.
4. Check the draft's assets, put the user-facing notes above the generated list, and publish it.
5. In the directory (community.obsidian.md), use **Check for new releases** on the plugin's page, and check its automated review.

If `minAppVersion` changes, edit it in `manifest.json` **before** running `npm version`, so `versions.json` records the right minimum for the new version.

## Community directory (1.0.0 submission)

Obsidian takes submissions through the community directory at **community.obsidian.md**, not through a pull request to `obsidianmd/obsidian-releases`. The directory reads `manifest.json` at the head of the default branch, installs from the GitHub release whose tag matches its version, and reviews each release automatically. Fix any errors it reports with a new, higher version; until then the plugin can't be installed from inside Obsidian.

### Checklist

Status as of 0.9.9 (checked against the docs on 2026-11-20): ✅ done · ⬜ needs you.

**Repository and files**
- ✅ `README.md` explains what the plugin does and how to use it, with screenshots, install, quick start, settings, privacy and limits.
- ✅ `LICENSE`: MIT, © 2026 Bob Casazza.
- ✅ `manifest.json` at the repository root. `id` `tasklines`: lowercase, doesn't contain "obsidian" or end in "plugin", unique. `name` `Tasklines`: Basic Latin, no "Obsidian", "Plugin" or core feature name. `author` Casazium, `authorUrl` the GitHub organization (not the repository). `minAppVersion` `1.13.0` from 1.0.3, for the declarative settings API; 1.0.0 to 1.0.2 support 1.10.0 and were tested on 1.10.3 (see VERIFY.md), and `versions.json` sends older apps to 1.0.2. `isDesktopOnly` false.
- ✅ `versions.json` maps each version to its minimum app version.
- ✅ Screenshots in `docs/screenshots/`, used by the README.
- ✅ The repository is public.
- ⬜ **Link your GitHub account to your Obsidian profile** on community.obsidian.md, so the directory can verify you own the repository.

**Release**
- ✅ The release workflow attaches `main.js`, `manifest.json` and `styles.css`, enforces tag = version, and marks only `0.x` and `x.y.z-…` as pre-release. 1.0.0 is published as a normal release.

**Code guidelines** (Plugin guidelines page)
- ✅ Uses `this.app`; no `innerHTML`, `outerHTML` or `insertAdjacentHTML`; only errors are logged; no sample-plugin names.
- ✅ Events through `registerEvent`, commands through `addCommand`, no default hotkeys, no leaves detached in `onunload`.
- ✅ Background edits use `Vault.process`; user paths go through `normalizePath`.
- ✅ Styles are CSS classes with Obsidian variables; dynamic values go through `setCssProps`.
- ✅ Settings headings use `setHeading()`, without "settings" or the plugin name.
- ✅ Mobile-safe: no Node or Electron APIs in `src/`, no regex lookbehind.
- ✅ Sentence case: lint passes. Product names (Tasklines, Dataview, Bases, Obsidian) are declared as brands in `eslint.config.mts`, and strings naming the Tasks plugin are exempt because "tasks" is also an ordinary word.
- ✅ `app.plugins` is read only to find the Tasks plugin's documented public API (`apiV1`) and its saved global filter.
- ✅ Settings use the declarative settings API (`getSettingDefinitions()`, Obsidian 1.13+), so they appear in settings search. There is no `display()`. Lint reports no warnings.
- The **Submission requirements** and **Developer policies** pages returned "not found" when last checked. Re-read them if they reappear.

### Steps

1. Merge the 1.0 pull request (this checklist, README and screenshots).
2. On a branch, run `npm version 1.0.0 --no-git-tag-version`, update the test vault's manifest, open a PR, and merge it once CI passes.
3. Tag `1.0.0` on `main` and push the tag. Check the draft release (three assets, not pre-release) and publish it.
4. Sign in at **community.obsidian.md** with your Obsidian account, link your GitHub account, and choose **Add your plugin** with the repository `casazium/tasklines`.
5. Watch the directory's automated review. Fix anything it reports with a 1.0.x release.
6. Once listed, check that the README's install steps match the directory, and say in the 1.0.0 release notes that it's the first release in the community directory.

## Screenshots

`docs/screenshots/` holds the README images:

| File | Shows |
| --- | --- |
| `overview.png` | `Project tasks.base` → **Open tasks** in `test-vault/`, set to **then by** Section, **Color** Due date and the Section column off: tasks grouped by `area` then section, overdue ones red, with note columns, the toolbar and the counts line |
| `editing.png` | **Due soon by owner**: a **Due** cell being edited |
| `new-task.png` | The **New task** window over the view |
| `mobile.png` | The view on a phone (Android emulator), with taller rows and the folded toolbar |
| `board.png` | `Task board.base` → **By status**, **Color** Due date: the four status columns, overdue cards red and today's orange |
| `calendar.png` | `Task calendar.base` → **Calendar** (month on desktop), **Color** Priority, with the No date tray |
| `urgent.png` | `Task board.base` → **Urgent and important** with **Color** Due date (set it in the view's menu, then put the file back): the 2×2 grid with its axes |
| `bulk.png` | The `overview.png` view in select mode: priority High set on Retro and Task inside a callout (the notice with Undo shows), then the "work" group and Fix gate and Dataview style selected. Undo the change afterwards |

`docs/listing/` holds the community directory's listing images. **The plugin's page takes at most 5 desktop and 5 phone images**, so the folder holds exactly those ten, numbered in upload order; when a release needs a new one, choose which to drop rather than adding a sixth.

- **Desktop**, 1200×800: dark theme, sidebar collapsed, window resized to 1200×800 (the board at 92% zoom so its four columns fit). `desktop-1-overview`, `desktop-2-editing`, `desktop-3-board`, `desktop-4-urgent` and `desktop-5-calendar` are the `overview.png`, `editing.png`, `board.png`, `urgent.png` and `calendar.png` scenes. (1.5.0 dropped `desktop-5-bulk`: select mode is on the phone set.) The window can be resized from the developer tools with `require('@electron/remote').getCurrentWindow().setSize(1200, 800)`.
- **Phone**, 900×1600: the top 1080×1920 of an Android emulator screenshot (light theme), scaled; `mobile-3-card-menu` uses the bottom 1920 instead, to show the menu sheet.
  - `mobile-1-list`: **All tasks by section** set to To do and In progress, grouped by due bucket then note, **Color** Note property `owner`.
  - `mobile-2-board`: **By status**, **Color** Due date.
  - `mobile-3-card-menu`: **Urgent and important**, **Color** Due date, swiped to Delegate with Confirm catering's **⋯** menu open (Move to Do first, Schedule, Later).
  - `mobile-4-agenda`: **Agenda**, **Color** Priority.
  - `mobile-5-select`: **Calendar** (the agenda on phones), **Color** Priority, in select mode with Overdue selected but one task and Today selected.

Upload them on the plugin's page at community.obsidian.md, replacing the old set.

To retake them: open `test-vault/` in light mode with the default theme, capture the window with `screencapture -x -o -l <window id>`, and resize with `sips -Z 1600`. Put back any notes you changed (`git checkout -- test-vault/`).
