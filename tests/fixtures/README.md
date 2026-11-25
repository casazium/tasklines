# Test fixtures

## task-lines.json

Task lines and what the parser should make of them. Every case also runs through the byte-safety, toggle and edit suites. Add a case for every parsing bug.

## obsidian-cache.json

What Obsidian's metadata cache reports (list items and headings) for the notes in `test-vault/Cache samples/`. `tests/obsidian-cache.test.ts` runs extraction against it, so the tests use Obsidian's real view of callouts, blockquotes, code blocks, comments, loose lists and mixed indentation instead of the guess in `tests/fake-vault.ts`.

It also feeds write-back:

- Every task line in these notes joins the per-line suites (toggle, edit, board, calendar, bulk) through `tests/fixture-lines.ts`, alongside `task-lines.json`.
- `tests/obsidian-cache.test.ts` ticks, unticks and sets a due date on each task inside its whole note. It checks that no other line or line ending changes, and that the note's tasks and nesting stay the same.

Add a sample note when a bug depends on how Obsidian reads a note's structure, then recapture.

### Recapturing

Recapture after adding, removing or changing a sample note (`npm test` fails until you do), and when a new Obsidian version might read lists differently.

1. Open `test-vault` in Obsidian and wait for it to finish indexing.
2. Open View → Toggle Developer Tools → Console, and run:

   ```js
   (async()=>{const out={};for(const f of app.vault.getMarkdownFiles().filter(f=>f.path.startsWith('Cache samples/')).sort((a,b)=>a.path<b.path?-1:1)){const c=app.metadataCache.getFileCache(f)??{};out[f.name]={content:await app.vault.read(f),listItems:c.listItems??[],headings:c.headings??[]};}await app.vault.adapter.write('Cache samples/_snapshot.json',JSON.stringify({obsidian:(navigator.userAgent.match(/obsidian\/([\d.]+)/)||[])[1],files:out},null,1));return Object.keys(out).join(', ')})()
   ```

3. Turn the capture into the fixture (it keeps only line numbers from each position), then delete the raw file:

   ```bash
   node tests/fixtures/import-cache-snapshot.ts
   ```

4. Run `npm test`. If an expectation in `tests/obsidian-cache.test.ts` changes, check the note by hand before updating it.
