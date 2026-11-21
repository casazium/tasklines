// DOM rendering for the task calendar (month grid and agenda). Uses only types from Obsidian;
// the adapter passes in callbacks for writing, opening notes, menus and the date picker.

import { CARD_PAGE, type MenuChoice } from './board-view.ts';
import { agenda, byDay, canClear, isRealDate, monthGrid, monthOf, quickDates, shiftMonth, type CalendarField, type CalendarLayout } from './calendar.ts';
import type { IndexedTask } from './extract.ts';
import type { IndexStats } from './indexer.ts';
import { statusKind } from './parser.ts';
import { formatSummary, summarize } from './query.ts';
import type { ViewRow } from './view.ts';
import { drawGroupSelect, drawSelectBox, type SelectionHooks } from './selection-bar.ts';

/** Tasks shown in a month cell before a "+N more" button. */
export const CELL_TASKS = 3;
/** Days at the start of the agenda shown even when empty, as drop targets (desktop only). */
const AGENDA_EMPTY_DAYS = 7;
const DRAG_TYPE = 'application/x-tasklines-task';

export interface CalendarInput {
	/** Filtered and sorted rows. */
	rows: ViewRow[];
	/** Tasks before task-level filters, for the "N filtered out" count. */
	total: number;
	today: string;
	field: CalendarField;
	layout: CalendarLayout;
	/** First day of the week, 0 = Sunday. */
	weekStart: number;
	stats: IndexStats;
	notes: { total: number; withTasks: number };
	openTask: (path: string, line: number, newTab: boolean) => void;
	toggleTask: (task: IndexedTask) => Promise<boolean>;
	/** Put the task on `date` (null removes the date); resolves true if the note changed. */
	move: (task: IndexedTask, date: string | null, label: string) => Promise<boolean>;
	showMenu: (anchor: HTMLElement, ev: MouseEvent, choices: MenuChoice[]) => void;
	/** Ask for a date; resolves to the date, or undefined if cancelled. */
	pickDate: (current: string | undefined) => Promise<string | undefined>;
	tasksPluginAvailable: boolean;
	touch: boolean;
	/** Select mode for bulk actions. */
	selection?: SelectionHooks;
}

const cardKey = (task: IndexedTask) => `${task.path}\n${task.line}`;
const isOpen = (task: IndexedTask) => !['done', 'cancelled'].includes(statusKind(task.status));
let idCount = 0;

/** A YYYY-MM-DD date as a Date at midnight UTC, so formatting never shifts the day. */
const utc = (date: string) => {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
};
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' });
const longDay = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const agendaDay = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = fmt({ day: 'numeric', month: 'short' });
const monthTitle = fmt({ month: 'long', year: 'numeric' });
const weekdayShort = fmt({ weekday: 'short' });

export function dayLabel(date: string, today: string): string {
	const name = agendaDay.format(utc(date));
	return date === today ? `Today · ${name}` : name;
}

type Refocus = { key: string; from: string; dayEl: string; index: number; until: number };

export class TaskCalendar {
	readonly el: HTMLElement;
	private live: HTMLElement;
	private statsEl: HTMLElement;
	private input: CalendarInput | null = null;
	/** The month shown (YYYY-MM-01); null until the first render, then kept across refreshes. */
	private month: string | null = null;
	/** Month cells showing all their tasks. */
	private expanded = new Set<string>();
	/** Tasks shown per long list (tray, Overdue, Later, No date), keyed by field and list. */
	private limits = new Map<string, number>();
	private dragged: IndexedTask | null = null;
	private deferred = false;
	/** Scroll back to the top on the next draw (the month changed). */
	private resetScroll = false;
	/** After a move from the menu: follow the task, or fall back near where it was. */
	private refocus: Refocus | null = null;

	constructor(parent: HTMLElement, statsEl: HTMLElement) {
		this.statsEl = statsEl;
		this.el = parent.createDiv({ cls: 'tasklines-calendar' });
		this.live = parent.createDiv({ cls: 'tasklines-sr-only', attr: { 'aria-live': 'polite', role: 'status' } });
	}

	resetLimits(): void {
		this.limits.clear();
	}

	render(input: CalendarInput): void {
		this.input = input;
		if (this.month === null) this.month = monthOf(input.today);
		if (this.dragged) {
			this.deferred = true;
			return;
		}
		this.deferred = false;
		this.draw(input);
	}

	private redraw(): void {
		if (this.input) this.draw(this.input);
	}

	private announce(text: string): void {
		this.live.setText('');
		window.setTimeout(() => this.live.setText(text), 50);
	}

	private async doMove(task: IndexedTask, date: string | null): Promise<void> {
		const input = this.input;
		if (!input) return;
		const label = date === null ? 'No date' : dayLabel(date, input.today);
		if (await input.move(task, date, label)) this.announce(`Moved "${task.text}" to ${label}.`);
	}

	private draw(input: CalendarInput): void {
		// Keep keyboard focus and scroll positions across the redraw.
		const focused = this.el.ownerDocument.activeElement;
		const inView = focused?.instanceOf(HTMLElement) && this.el.contains(focused);
		const focusCard = inView ? focused.closest<HTMLElement>('[data-key]')?.dataset.key : undefined;
		const focusKey = inView ? focused.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey : undefined;
		const scrolls = new Map<string, [number, number]>();
		if (!this.resetScroll) {
			this.el.querySelectorAll<HTMLElement>('[data-scroll]').forEach((s) => {
				if (s.dataset.scroll) scrolls.set(s.dataset.scroll, [s.scrollLeft, s.scrollTop]);
			});
		}
		this.resetScroll = false;

		this.el.empty();
		this.el.toggleClass('is-agenda', input.layout === 'agenda');
		let shown: ViewRow[] = input.rows;
		if (input.total === 0) {
			this.el.createDiv({ cls: 'tasklines-empty', text: 'No checkbox tasks in the notes this base selects.' });
		} else if (input.layout === 'month') {
			this.drawMonth(input);
		} else {
			shown = this.drawAgenda(input);
		}
		this.drawStats(input, shown);

		this.el.querySelectorAll<HTMLElement>('[data-scroll]').forEach((s) => {
			const pos = s.dataset.scroll ? scrolls.get(s.dataset.scroll) : undefined;
			if (pos) {
				s.scrollLeft = pos[0];
				s.scrollTop = pos[1];
			}
		});
		if (this.restoreMoveFocus()) return;
		if (focusKey) this.focusIn(focusCard, focusKey);
	}

	private drawStats(input: CalendarInput, shown: ViewRow[]): void {
		const s = input.stats;
		const hidden = input.total - shown.length;
		this.statsEl.empty();
		this.statsEl.createSpan({ cls: 'tasklines-summary', text: formatSummary(summarize(shown, input.today)) });
		this.statsEl.createSpan({
			text: `${hidden > 0 ? ` · ${hidden} filtered out` : ''} · ${input.notes.total} notes (${input.notes.total - input.notes.withTasks} without tasks) · ${s.ms.toFixed(0)} ms`,
		});
	}

	private drawMonth(input: CalendarInput): void {
		const month = this.month ?? monthOf(input.today);
		const nav = this.el.createDiv({ cls: 'tasklines-cal-nav' });
		const titleId = `tasklines-cal-title-${++idCount}`;
		const navBtn = (text: string, label: string, key: string, to: string) => {
			const b = nav.createEl('button', { cls: 'tasklines-btn', text, attr: { 'aria-label': label, 'data-focus-key': key } });
			b.addEventListener('click', () => {
				if (this.month === to) return;
				this.month = to;
				this.expanded.clear();
				this.resetScroll = true;
				this.redraw();
				this.announce(monthTitle.format(utc(to)));
			});
		};
		navBtn('‹', 'Previous month', 'nav-prev', shiftMonth(month, -1));
		navBtn('Today', 'This month', 'nav-today', monthOf(input.today));
		navBtn('›', 'Next month', 'nav-next', shiftMonth(month, 1));
		nav.createEl('h3', { cls: 'tasklines-cal-title', text: monthTitle.format(utc(month)), attr: { id: titleId } });

		const { days, undated } = byDay(input.rows, input.field);
		const body = this.el.createDiv({ cls: 'tasklines-cal-body', attr: { 'data-scroll': 'body' } });
		const scroll = body.createDiv({ cls: 'tasklines-cal-scroll', attr: { 'data-scroll': 'grid' } });
		const grid = scroll.createDiv({ cls: 'tasklines-cal-grid', attr: { role: 'group', 'aria-labelledby': titleId } });
		const weeks = monthGrid(month, input.weekStart);
		const head = grid.createDiv({ cls: 'tasklines-cal-weekdays', attr: { 'aria-hidden': 'true' } });
		for (const day of weeks[0] ?? []) head.createDiv({ text: weekdayShort.format(utc(day)) });
		for (const week of weeks) {
			const row = grid.createDiv({ cls: 'tasklines-cal-week' });
			for (const day of week) this.drawDay(row, day, days.get(day) ?? [], input, day.startsWith(month.slice(0, 7)));
		}
		this.drawTray(body, undated, input);
	}

	private drawDay(parent: HTMLElement, day: string, rows: ViewRow[], input: CalendarInput, inMonth: boolean): void {
		const n = rows.length;
		const cell = parent.createDiv({ cls: 'tasklines-cal-day' });
		cell.dataset.day = day;
		cell.toggleClass('is-today', day === input.today);
		cell.toggleClass('is-other-month', !inMonth);
		cell.toggleClass('is-past', day < input.today);
		const titleId = `tasklines-cal-day-${++idCount}`;
		// Focusable (not in the tab order) so focus can land here when a moved task leaves the day.
		const head = cell.createDiv({ cls: 'tasklines-cal-daynum', attr: { id: titleId, tabindex: '-1', 'data-focus-key': `day:${day}` } });
		head.createSpan({ text: String(Number(day.slice(8))) });
		head.createSpan({ cls: 'tasklines-sr-only', text: ` ${longDay.format(utc(day))}${day === input.today ? ', today' : ''}, ${n} ${n === 1 ? 'task' : 'tasks'}` });
		const list = cell.createDiv({ cls: 'tasklines-cal-list', attr: { role: 'list', 'aria-labelledby': titleId } });
		const all = this.expanded.has(day);
		for (const row of all ? rows : rows.slice(0, CELL_TASKS)) this.drawChip(list, row, input, false, day);
		if (n > CELL_TASKS) {
			const more = cell.createEl('button', { cls: 'tasklines-cal-more', text: all ? 'Show fewer' : `+${n - CELL_TASKS} more`, attr: { 'data-focus-key': `more:${day}` } });
			more.addEventListener('click', () => {
				if (all) this.expanded.delete(day);
				else this.expanded.add(day);
				this.redraw();
			});
		}
		this.dropTarget(cell, day, input);
	}

	/** Draw up to the list's limit, then a "Show more" button. */
	private drawPaged(list: HTMLElement, after: HTMLElement, rows: ViewRow[], input: CalendarInput, listKey: string, showDate: boolean, dayEl: string): void {
		const limitKey = `${input.field}:${listKey}`;
		const limit = this.limits.get(limitKey) ?? CARD_PAGE;
		for (const row of rows.slice(0, limit)) this.drawChip(list, row, input, showDate, dayEl);
		if (rows.length > limit) {
			const more = after.createEl('button', { cls: 'tasklines-btn tasklines-more', text: `Show ${Math.min(CARD_PAGE, rows.length - limit)} more`, attr: { 'data-focus-key': `more:${listKey}` } });
			more.addEventListener('click', () => {
				this.limits.set(limitKey, limit + CARD_PAGE);
				this.redraw();
			});
		}
	}

	/** Tasks without the chosen date (or with one that is not a real day): dropping here removes the date. */
	private drawTray(parent: HTMLElement, rows: ViewRow[], input: CalendarInput): void {
		const tray = parent.createDiv({ cls: 'tasklines-cal-tray' });
		tray.dataset.day = 'none';
		const titleId = `tasklines-cal-tray-${++idCount}`;
		const head = tray.createDiv({ cls: 'tasklines-column-head', attr: { role: 'heading', 'aria-level': '3', id: titleId, tabindex: '-1', 'data-focus-key': 'day:none' } });
		head.createSpan({ cls: 'tasklines-column-title', text: 'No date' });
		const count = head.createSpan({ cls: 'tasklines-column-count', text: String(rows.length) });
		count.createSpan({ cls: 'tasklines-sr-only', text: rows.length === 1 ? ' task' : ' tasks' });
		if (input.selection?.active) drawGroupSelect(head, rows.map((r) => r.task), input.selection, 'No date');
		const scroll = tray.createDiv({ cls: 'tasklines-column-cards', attr: { 'data-scroll': 'tray' } });
		const list = scroll.createDiv({ cls: 'tasklines-card-list', attr: { role: 'list', 'aria-labelledby': titleId } });
		this.drawPaged(list, scroll, rows, input, 'none', false, 'none');
		if (!rows.length) scroll.createDiv({ cls: 'tasklines-column-empty', text: 'Drop a task here to remove its date' });
		this.dropTarget(tray, null, input);
	}

	/** Draws the agenda; returns the rows it shows (finished tasks dated before today are left out). */
	private drawAgenda(input: CalendarInput): ViewRow[] {
		const scroll = this.el.createDiv({ cls: 'tasklines-cal-scroll tasklines-agenda', attr: { 'data-scroll': 'agenda' } });
		const shown: ViewRow[] = [];
		for (const section of agenda(input.rows, input.field, input.today, input.touch ? 1 : AGENDA_EMPTY_DAYS)) {
			shown.push(...section.rows);
			const sec = scroll.createDiv({ cls: 'tasklines-agenda-section' });
			sec.dataset.day = section.key;
			sec.toggleClass('is-locked', section.date === null && section.key !== 'none');
			const titleId = `tasklines-agenda-${++idCount}`;
			const label = section.key === 'overdue' ? 'Overdue' : section.key === 'later' ? 'Later' : section.key === 'none' ? 'No date' : dayLabel(section.key, input.today);
			const head = sec.createDiv({ cls: 'tasklines-agenda-head', attr: { role: 'heading', 'aria-level': '3', id: titleId, tabindex: '-1', 'data-focus-key': `day:${section.key}` } });
			head.createSpan({ cls: 'tasklines-column-title', text: label });
			const count = head.createSpan({ cls: 'tasklines-column-count', text: String(section.rows.length) });
			count.createSpan({ cls: 'tasklines-sr-only', text: section.rows.length === 1 ? ' task' : ' tasks' });
			if (input.selection?.active) drawGroupSelect(head, section.rows.map((r) => r.task), input.selection, label);
			const list = sec.createDiv({ cls: 'tasklines-card-list', attr: { role: 'list', 'aria-labelledby': titleId } });
			if (section.date === null) this.drawPaged(list, sec, section.rows, input, section.key, section.key !== 'none', section.key);
			else for (const row of section.rows) this.drawChip(list, row, input, false, section.key);
			if (!section.rows.length) sec.createDiv({ cls: 'tasklines-column-empty', text: section.key === 'none' ? 'Drop a task here to remove its date' : 'Nothing scheduled' });
			if (section.date !== null) this.dropTarget(sec, section.date, input);
			else if (section.key === 'none') this.dropTarget(sec, null, input);
		}
		return shown;
	}

	private dropTarget(el: HTMLElement, date: string | null, input: CalendarInput): void {
		const accepts = (ev: DragEvent) => {
			const t = this.dragged;
			if (!t || !ev.dataTransfer?.types.includes(DRAG_TYPE)) return false;
			if ((t[input.field] ?? null) === date) return false;
			return date !== null || canClear(t, input.field);
		};
		el.addEventListener('dragover', (ev) => {
			if (!accepts(ev)) return;
			ev.preventDefault();
			if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
			el.addClass('is-drop-target');
		});
		el.addEventListener('dragleave', (ev) => {
			const to = ev.relatedTarget as Node | null;
			if (!to || !el.contains(to)) el.removeClass('is-drop-target');
		});
		el.addEventListener('drop', (ev) => {
			el.removeClass('is-drop-target');
			if (!accepts(ev) || !this.dragged) return;
			ev.preventDefault();
			ev.stopPropagation();
			void this.doMove(this.dragged, date);
		});
	}

	/**
	 * One task: checkbox, text (opens the note), menu. `showDate` adds the date (the agenda's range
	 * sections); a date that is not a real day is always shown, so it can be found and fixed.
	 */
	private drawChip(parent: HTMLElement, row: ViewRow, input: CalendarInput, showDate: boolean, dayEl: string): void {
		const { task } = row;
		const kind = statusKind(task.status);
		const open = isOpen(task);
		const date = task[input.field];
		const valid = !!date && isRealDate(date);
		const overdue = open && valid && date < input.today;
		const chip = parent.createDiv({ cls: `tasklines-card tasklines-cal-chip tasklines-status-${kind}`, attr: { role: 'listitem', title: `${task.text} — ${row.noteName}` } });
		chip.dataset.key = cardKey(task);
		chip.dataset.day = dayEl;
		chip.toggleClass('is-overdue', overdue);
		const top = chip.createDiv({ cls: 'tasklines-card-top' });
		if (input.selection?.active) drawSelectBox(top, chip, task, input.selection);
		else {
			const box = top.createEl('input', {
				type: 'checkbox',
				cls: 'task-list-item-checkbox tasklines-checkbox',
				attr: { 'aria-label': open ? `Complete: ${task.text}` : `Reopen: ${task.text}`, 'data-task': task.status, 'data-focus-key': 'check' },
			});
			if (task.recurrence && open && !input.tasksPluginAvailable) {
				box.addClass('tasklines-needs-tasks');
				box.setAttr('title', 'Completing a recurring task needs the Tasks plugin (7.2.0 or later). Open the note to complete it there.');
			}
			box.checked = kind !== 'todo';
			box.indeterminate = kind === 'in-progress';
			box.addEventListener('click', (ev) => {
				ev.preventDefault();
				if (box.getAttr('aria-disabled') === 'true') return;
				box.setAttr('aria-disabled', 'true');
				void input.toggleTask(task).finally(() => box.removeAttribute('aria-disabled'));
			});
			const link = top.createEl('a', { text: task.text || '(empty)', href: '#', cls: 'tasklines-open tasklines-card-text', attr: { draggable: 'false' } });
			link.setAttr('aria-label', `${task.text} — open ${task.path} at line ${task.line + 1}`);
			link.dataset.focusKey = 'open';
			link.addEventListener('click', (ev) => {
				ev.preventDefault();
				input.openTask(task.path, task.line, ev.metaKey || ev.ctrlKey);
			});
			const menuBtn = top.createEl('button', { cls: 'clickable-icon tasklines-card-menu', text: '⋯', attr: { 'aria-label': `Reschedule: ${task.text}`, 'aria-haspopup': 'menu', 'data-focus-key': 'menu' } });
			menuBtn.addEventListener('click', (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				const index = Array.from(parent.children).indexOf(chip);
				const move = (d: string | null) => {
					this.refocus = { key: cardKey(task), from: date ?? '', dayEl, index, until: Date.now() + 5000 };
					// Make sure the task will be drawn where it lands.
					if (d) this.expanded.add(d);
					void this.doMove(task, d);
				};
				const choices: MenuChoice[] = quickDates(task, input.field, input.today).map((c) => ({ label: c.label, run: () => move(c.date) }));
				choices.push({
					label: 'Pick a date…',
					run: () => {
						void input.pickDate(valid ? date : undefined).then((picked) => {
							if (picked !== undefined && picked !== date) move(picked);
						});
					},
				});
				input.showMenu(menuBtn, ev, choices);
			});
		}
		const showMeta = (showDate && !!date) || !!(date && !valid) || !!task.recurrence || overdue;
		if (showMeta) {
			const meta = chip.createDiv({ cls: 'tasklines-card-meta' });
			if (date && !valid) meta.createSpan({ cls: 'tasklines-card-due is-overdue', text: `Not a real date: ${date}` });
			else if (date && showDate) {
				const d = meta.createSpan({ cls: `tasklines-card-due${overdue ? ' is-overdue' : ''}`, text: shortDate.format(utc(date)) });
				if (overdue) d.createSpan({ cls: 'tasklines-sr-only', text: ' (overdue)' });
			} else if (overdue) meta.createSpan({ cls: 'tasklines-sr-only', text: '(overdue)' });
			if (task.recurrence) meta.createSpan({ text: '🔁', attr: { role: 'img', 'aria-label': `Repeats ${task.recurrence}` } });
		}

		if (input.touch || input.selection?.active) return; // phones reschedule with the menu; select mode doesn't drag
		chip.draggable = true;
		chip.addEventListener('dragstart', (ev) => {
			if (!ev.dataTransfer) return;
			this.dragged = task;
			ev.dataTransfer.setData(DRAG_TYPE, cardKey(task));
			ev.dataTransfer.effectAllowed = 'move';
			chip.addClass('is-dragging');
		});
		chip.addEventListener('dragend', () => {
			this.dragged = null;
			chip.removeClass('is-dragging');
			this.el.querySelectorAll('.is-drop-target').forEach((e) => e.removeClass('is-drop-target'));
			if (this.deferred && this.input) this.render(this.input);
		});
	}

	/** Focus a control: inside a task when `key` is given, otherwise anywhere in the view (nav, "more", day headings). */
	private focusIn(key: string | undefined, focusKey: string): boolean {
		let scope: ParentNode = this.el;
		if (key) {
			const card = Array.from(this.el.querySelectorAll<HTMLElement>('.tasklines-cal-chip')).find((c) => c.dataset.key === key);
			if (!card) return false;
			scope = card;
		}
		const target = Array.from(scope.querySelectorAll<HTMLElement>('[data-focus-key]')).find((e) => e.dataset.focusKey === focusKey);
		if (!target) return false;
		target.closest<HTMLElement>('.tasklines-cal-day, .tasklines-agenda-section, .tasklines-cal-tray')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		target.focus({ preventScroll: true });
		return true;
	}

	/**
	 * After a menu move, follow the task to its new day. Until the write lands the task is still in
	 * its old place; once it has moved (or is no longer drawn) this stops, falling back to the next
	 * task where it was, or that day's heading.
	 */
	private restoreMoveFocus(): boolean {
		const r = this.refocus;
		if (!r) return false;
		if (Date.now() > r.until) {
			this.refocus = null;
			return false;
		}
		const chip = Array.from(this.el.querySelectorAll<HTMLElement>('.tasklines-cal-chip')).find((c) => c.dataset.key === r.key);
		if (chip && chip.dataset.day === r.dayEl) return this.focusIn(r.key, 'menu'); // not written yet
		this.refocus = null;
		if (chip) return this.focusIn(r.key, 'menu');
		const place = Array.from(this.el.querySelectorAll<HTMLElement>('[data-day]')).find((d) => !d.hasClass('tasklines-cal-chip') && d.dataset.day === r.dayEl);
		const chips = place ? Array.from(place.querySelectorAll<HTMLElement>('.tasklines-cal-chip')) : [];
		const next = chips[Math.min(r.index, chips.length - 1)];
		if (next?.dataset.key && this.focusIn(next.dataset.key, 'menu')) return true;
		return this.focusIn(undefined, `day:${r.dayEl}`);
	}
}
