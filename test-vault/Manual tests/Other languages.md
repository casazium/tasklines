A manual check for Obsidian in Arabic, a right-to-left language whose Moment locale writes dates in other digits. Run it before a release that touches dates, write-back, the Tasks plugin, or layout and styles. Record the results in VERIFY.md; the checks below are plain bullets so the base shows only the sample tasks.

## Set up

1. In `test-vault`, turn on Tasklines and Tasks.
2. Settings → General → Language: choose **العربية** (Arabic) and relaunch.
3. Open this note; the base below lists only the tasks in this folder. Command names are now in Arabic: search the command palette for **معلومات** to find "Show debug info".

## Tasks to check

- [ ] سقي النباتات 🔁 every day 📅 2026-11-29
- [ ] مراجعة التقرير 📅 2026-11-30 ⏫
- [ ] Call Sarah about the Q4 report 📅 2026-12-01
- [ ] اتصل بـ Sarah بخصوص تقرير Q4 📅 2026-12-02
- [ ] לקנות חלב 📅 2026-12-03
- [ ] Plain task with no date
    - [ ] مهمة فرعية

```base
filters:
  and:
    - file.inFolder("Manual tests")
views:
  - type: tasklines
    name: List
  - type: tasklines-board
    name: Board
  - type: tasklines-calendar
    name: Calendar
```

## Checks

**Layout**
- List, Board and Calendar mirror right to left: columns, toolbar and the calendar's borders.
- The calendar week starts on Saturday, and its headings line up with the dates.
- English names such as "Call Sarah about the Q4 report" are cut off at their end, not their start.
- In mixed lines, "Sarah" and "Q4" stay where they are in the note, and the counts in the summary line read in order.

**Writing back** (in Source mode, after each step)
- Set a due date from the list: the line gets `📅` with 0–9 digits.
- Move a card on the board, and a task in the calendar: the dates written use 0–9 digits.
- Tick "Plain task with no date", then untick it: the line comes back as it was.
- Tick "سقي النباتات" (recurring): Tasklines refuses with a notice and the note is unchanged. Tasks 8.6.0 would write Arabic-Indic digits here (obsidian-tasks-group/obsidian-tasks#4160). If a later Tasks version fixes that, the next occurrence should appear with 0–9 digits instead.
- Tick "مراجعة التقرير": it is completed with `✅` and a 0–9 date, keeping its due date and priority.

## Afterwards

1. Switch the language back to English and relaunch.
2. Put the notes back: `git checkout -- test-vault/`.
