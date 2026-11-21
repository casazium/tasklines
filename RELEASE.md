# Releasing Tasklines

## Cutting a release

Versions are plain `x.y.z` (Obsidian supports nothing else), and the git tag must equal the version exactly, with no `v` prefix. `.npmrc` sets `tag-version-prefix=""` so `npm version` does this.

```bash
git switch main && git pull
npm version 0.9.1        # bumps package.json, manifest.json and versions.json, commits and tags 0.9.1
git push --follow-tags
```

The **Release Obsidian plugin** workflow then:

1. Fails if the tag doesn't match `manifest.json`, `package.json` and an entry in `versions.json`.
2. Builds, lints and runs the tests.
3. Attests build provenance for `main.js` and `styles.css`.
4. Creates a **draft** GitHub release with `main.js`, `manifest.json` and `styles.css`, and generated notes. Versions `0.x` (and any `x.y.z-…`) are marked **pre-release**: BRAT installs them, Obsidian's plugin browser doesn't.

Check the draft's notes and assets, then publish it.

If `minAppVersion` changes, edit it in `manifest.json` **before** running `npm version`, so `versions.json` records the right minimum for the new version.

## Beta (0.9.x)

1. Merge the milestone branches into `main`.
2. Run [VERIFY.md](VERIFY.md) in `test-vault/` on desktop, and at least the mobile line on a phone.
3. Tag `0.9.0` as above and publish the draft pre-release.
4. Install it through BRAT (`casazium/tasklines`) in your own vaults. BRAT needs read access to the repository, so either make the repository public or give BRAT a GitHub token that can read it.
5. Fix what turns up with `0.9.x` releases, adding a parser fixture for every parsing bug.

## 1.0.0 and community submission

Obsidian takes submissions through the community directory at **community.obsidian.md**, not through a pull request to `obsidianmd/obsidian-releases`. The directory reads `manifest.json` at the head of the default branch, installs from the GitHub release whose tag matches its version, and reviews each release automatically. Fix any errors it reports with a new, higher version; until then the plugin can't be installed from inside Obsidian.

### Checklist

Status as of 0.9.9 (checked against the docs on 2026-11-20): ✅ done · ⬜ needs you.

**Repository and files**
- ✅ `README.md` explains what the plugin does and how to use it, with screenshots, install, quick start, settings, privacy and limits.
- ✅ `LICENSE`: MIT, © 2026 Bob Casazza.
- ✅ `manifest.json` at the repository root. `id` `tasklines`: lowercase, doesn't contain "obsidian" or end in "plugin", unique. `name` `Tasklines`: Basic Latin, no "Obsidian", "Plugin" or core feature name. `author` Casazium, `authorUrl` the GitHub organization (not the repository). `minAppVersion` `1.10.0`, tested on 1.10.3 (see VERIFY.md). `isDesktopOnly` false.
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
- Known lint warnings, not errors: `prefer-setting-definitions` and the deprecated `display()`. Obsidian 1.13 added a declarative settings API, which makes settings searchable. Adopting it while keeping 1.10 support means providing both; it's a follow-up, listed in the README's known limits.
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
| `overview.png` | `Project tasks.base` → **Open tasks** in `test-vault/`: tasks grouped by `area` with note columns, the toolbar and the counts line |
| `editing.png` | A ticked task and a **Due** cell being edited |
| `new-task.png` | The **New task** window over the view |
| `mobile.png` | The view on a phone (Android emulator), with taller rows and the folded toolbar |

To retake them: open `test-vault/` in light mode with the default theme, capture the window with `screencapture -x -o -l <window id>`, and resize with `sips -Z 1600`. Put back any notes you changed (`git checkout -- test-vault/`).
