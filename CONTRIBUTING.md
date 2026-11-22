# Contributing to Tasklines

Thanks for helping. Tasklines edits people's notes, so the bar for changes is that they never damage a note. These notes explain how to report problems, suggest features, set up the project and get a change accepted.

## Reporting a problem

Open an [issue](https://github.com/casazium/tasklines/issues) with:

- Your Obsidian version, platform (desktop or phone) and Tasklines version.
- What you did, what you expected and what happened.
- The task line involved, copied exactly as it appears in the note (inside a code block, so spaces and emoji survive). If a change was refused, include the notice's text.
- Whether the Tasks or Dataview plugins are installed, and any Tasks settings you've changed (task format, global filter, custom statuses).

Please don't paste private notes. A made-up line that shows the same problem is ideal.

## Ideas and questions

Feature requests, ideas and questions go in [Discussions](https://github.com/casazium/tasklines/discussions), not the issue tracker:

- **Ideas:** what you'd like Tasklines to do, and the job it would help with in your vault. Upvote ideas you'd use too; that's how the next features are chosen.
- **Q&A:** how to set something up, or whether Tasklines can do something.

Some requests are out of scope by design: network access, telemetry, reminders, time tracking and new task syntax (see the rules below).

## Setting up

You need Node 22.18 or newer.

```bash
npm ci
npm run build   # type-check and bundle to main.js
npm test        # parser fixtures, write-back safety, fuzz and feature tests
npm run lint    # eslint with eslint-plugin-obsidianmd; must report no warnings
npm run bench   # index and query timing on a synthetic vault
```

To try a build in Obsidian, open `test-vault/` as a vault and copy `main.js`, `manifest.json` and `styles.css` into `test-vault/.obsidian/plugins/tasklines/`. After rebuilding, close and reopen any open base. If you're testing the settings tab, quit and reopen Obsidian, because its Settings window keeps the old code until then.

## Rules every change keeps

[AGENTS.md](AGENTS.md) lists them in full. The most important:

- **Notes change only through `Vault.process`, one line at a time.** Editing logic lives in pure functions (`src/edit.ts`, `src/writeback.ts`) that refuse rather than guess when a line no longer matches.
- **Keep each line's format.** Edits use the style the line already has (Tasks emoji or Dataview fields), never convert between them, and never touch text inside inline code.
- **Every parsing bug gets a fixture** in `tests/fixtures/task-lines.json`. Each fixture is run through the byte-safety, toggle and edit suites automatically.
- **Only `src/bases-adapter.ts` uses the Bases API.**
- **Mobile-safe:** no Node or Electron APIs in `src/`, and no regex lookbehind.
- **No network access, telemetry, reminders, time tracking or new task syntax.** Tasklines works with the syntax people already use.

## Making a change

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Work on a branch and keep the change focused.
3. Add or update tests. For parser or write-back changes, add a fixture, and run the fuzz test larger before opening the pull request: `FUZZ_CASES=200000 FUZZ_SEED=7 node --test tests/fuzz.test.ts`.
4. Check the change in Obsidian using the relevant steps in [VERIFY.md](VERIFY.md).
5. Make sure `npm run build`, `npm run lint` and `npm test` pass, then open a pull request that says what changed and why.

Releases are made by the maintainers, following [RELEASE.md](RELEASE.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
