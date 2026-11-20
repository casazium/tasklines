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

Obsidian now takes submissions through the community directory at **community.obsidian.md**, not through a pull request to `obsidianmd/obsidian-releases`. The directory reads `manifest.json` at the head of the default branch, and reviews each release automatically. Fix any errors with a new, higher version.

### Checklist

Status as of milestone 5: ✅ done · ⬜ needs you · 🔍 check against the docs.

**Repository and files**
- ✅ `README.md` explains what the plugin does and how to use it, with install, quick start, settings, privacy and limits.
- ✅ `LICENSE`: MIT, © 2026 Bob Casazza.
- ✅ `manifest.json` at the repository root: `id` `tasklines` (unique among the 10,642 published plugins checked; doesn't contain "obsidian"), `version` x.y.z, `minAppVersion` `1.10.0` (all APIs used are from 1.10.0 or earlier), `isDesktopOnly` false, description 135 characters, ending in a full stop, no emoji.
- ✅ `versions.json` maps each version to its minimum app version.
- ⬜ **Screenshots** in `docs/screenshots/` and referenced from the README (shot list below).
- ⬜ **Repository visibility.** The directory needs to reach the source on GitHub. Make `casazium/tasklines` public before submitting.
- ⬜ **Link your GitHub account to your Obsidian profile** so the directory can verify you own the repository.
- ⬜ Merge to `main` first: the directory reads the default branch.

**Release**
- ✅ The release workflow attaches `main.js`, `manifest.json` and `styles.css`, and enforces tag = version.
- ⬜ Publish **1.0.0** as a normal (not pre-release) GitHub release.

**Code guidelines** (from the Plugin guidelines page)
- ✅ Uses `this.app`, never the global `app`.
- ✅ No `innerHTML`/`outerHTML`/`insertAdjacentHTML`. The DOM is built with `createEl`/`createDiv`/`createSpan`.
- ✅ Only errors are logged (`console.error` on a failed write).
- ✅ No sample-plugin placeholder names.
- ✅ Events through `registerEvent`, commands through `addCommand`. No leaves detached in `onunload`.
- ✅ No default hotkeys. The one command uses `editorCheckCallback` and isn't prefixed with the plugin name.
- ✅ Background edits use `Vault.process`. No `Vault.modify`, `vault.adapter`, `activeLeaf` or `getFiles().find`.
- ✅ User paths (excluded folders, new `.base` files) go through `normalizePath`.
- ✅ Styles are CSS classes with Obsidian variables. Dynamic values (row height, scroll offset, indent, column template) are passed as CSS custom properties through `setCssProps`.
- ✅ Settings use `setHeading()` for the three sections, with no "settings" or plugin name in headings.
- ✅ Mobile-safe: no Node or Electron APIs, no regex lookbehind.
- 🔍 Sentence case: lint warns about capitalized product names ("Tasks plugin", "Dataview", "Bases"). They're kept on purpose; confirm the automated review accepts them.
- 🔍 `app.plugins` is read to find the Tasks plugin's public API (`apiV1`). That's the access path Tasks documents, but it isn't in Obsidian's public typings.
- 🔍 The **Submission requirements** page (manifest wording and naming rules) wasn't available when this was written (the docs URL returned "Not Found"). Re-read it, and the **Developer policies** page, before submitting.

## Screenshots to take

Take these in `test-vault/` with the default theme, light mode, at about 1400×900. Save them as PNG in `docs/screenshots/` with these names, and add the first two to the top of the README.

| File | What to show |
| --- | --- |
| `overview.png` | `Project tasks.base` → **Open tasks**: tasks grouped by `area`, with `status` and `owner` note columns, the toolbar, and the counts line |
| `editing.png` | A **Due** cell open with the date picker, next to a ticked task with its ✅ date |
| `by-owner.png` | **Due soon by owner** grouped by the `owner` property, with Overdue and Days until due columns on |
| `new-task.png` | The **New task** dialog over the view |
| `dataview-migration.png` | `Dataview queries.md` with its query beside the generated `.base` |
| `mobile.png` | The view on a phone, showing the taller rows |
