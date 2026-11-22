// DOM rendering for the task board. Uses only types from Obsidian; the adapter passes in
// callbacks for writing, opening notes and showing menus.

import type { BoardColumn, BoardField, BoardMove } from './board.ts';
import type { IndexedTask } from './extract.ts';
import type { IndexStats } from './indexer.ts';
import { statusKind } from './parser.ts';
import { formatSummary, summarize } from './query.ts';
import type { ViewRow } from './view.ts';
import { drawGroupSelect, drawSelectBox, type SelectionHooks } from './selection-bar.ts';

/** Cards drawn per column before a "Show more" button; keeps huge columns cheap to draw. */
export const CARD_PAGE = 100;
/** Our own drag type, so a card dropped on a note or another app is not inserted as text. */
const DRAG_TYPE = 'application/x-tasklines-task';
let columnCount = 0;

export interface MenuChoice {
	label: string;
	disabled?: boolean;
	run: () => void;
}

export interface BoardInput {
	columns: BoardColumn<ViewRow>[];
	/** Tasks before task-level filters, for the "N filtered out" count. */
	total: number;
	today: string;
	/** Which task field the columns are; that field is left off the cards. */
	field: BoardField;
	stats: IndexStats;
	notes: { total: number; withTasks: number };
	openTask: (path: string, line: number, newTab: boolean) => void;
	toggleTask: (task: IndexedTask) => Promise<boolean>;
	/** What moving the task into the column would do (worked out at the moment of the move). */
	moveFor: (task: IndexedTask, column: BoardColumn) => BoardMove | null;
	/** Carry out a move; resolves true if the note changed. */
	move: (task: IndexedTask, move: BoardMove, column: BoardColumn) => Promise<boolean>;
	/** Show a menu for the button; `ev` places it at the pointer when the click came from one. */
	showMenu: (anchor: HTMLElement, ev: MouseEvent, choices: MenuChoice[]) => void;
	tasksPluginAvailable: boolean;
	touch: boolean;
	/** Select mode for bulk actions. */
	selection?: SelectionHooks;
}

const PRIORITY_MARK: Record<string, string> = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' };
const cardKey = (task: IndexedTask) => `${task.path}\n${task.line}`;

export class TaskBoard {
	readonly el: HTMLElement;
	private live: HTMLElement;
	private statsEl: HTMLElement;
	private input: BoardInput | null = null;
	/** Cards shown per column, keyed by field and column; reset when the filters change. */
	private limits = new Map<string, number>();
	/** The card being dragged. Drag data cannot be read during dragover, so keep it here. */
	private dragged: IndexedTask | null = null;
	/** A redraw that arrived mid-drag; it would replace the columns under the pointer. */
	private deferred = false;
	/** After a move from the menu: keep keyboard focus on the card, or near where it was. */
	private refocus: { key: string; from: string; index: number; until: number } | null = null;

	constructor(parent: HTMLElement, statsEl: HTMLElement) {
		this.statsEl = statsEl;
		this.el = parent.createDiv({ cls: 'tasklines-board' });
		this.live = parent.createDiv({ cls: 'tasklines-sr-only', attr: { 'aria-live': 'polite', role: 'status' } });
	}

	resetLimits(): void {
		this.limits.clear();
	}

	render(input: BoardInput): void {
		this.input = input;
		if (this.dragged) {
			this.deferred = true;
			return;
		}
		this.deferred = false;
		this.draw(input);
	}

	private announce(text: string): void {
		// Clear first so the same message twice is still read out.
		this.live.setText('');
		window.setTimeout(() => this.live.setText(text), 50);
	}

	private async doMove(task: IndexedTask, column: BoardColumn): Promise<void> {
		const input = this.input;
		if (!input) return;
		const move = input.moveFor(task, column);
		if (!move) return;
		const changed = await input.move(task, move, column);
		if (changed) this.announce(`Moved "${task.text}" to ${column.label}.`);
	}

	private draw(input: BoardInput): void {
		const shown = input.columns.flatMap((c) => c.rows);
		const hidden = input.total - shown.length;
		const s = input.stats;
		this.statsEl.empty();
		this.statsEl.createSpan({ cls: 'tasklines-summary', text: formatSummary(summarize(shown, input.today)) });
		this.statsEl.createSpan({
			text: `${hidden > 0 ? ` · ${hidden} filtered out` : ''} · ${input.notes.total} notes (${input.notes.total - input.notes.withTasks} without tasks) · ${s.ms.toFixed(0)}\u00a0ms`,
		});

		// Redrawing replaces every card: keep scroll positions and keyboard focus.
		const boardEl = this.el;
		const focused = boardEl.ownerDocument.activeElement;
		const inBoard = focused?.instanceOf(HTMLElement) && boardEl.contains(focused);
		const focusCard = inBoard ? focused.closest<HTMLElement>('.tasklines-card')?.dataset.key : undefined;
		const focusKey = inBoard ? focused.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey : undefined;
		const scrollLeft = boardEl.scrollLeft;
		const columnScroll = new Map<string, number>();
		boardEl.querySelectorAll<HTMLElement>('.tasklines-column-cards').forEach((el) => {
			if (el.dataset.column) columnScroll.set(el.dataset.column, el.scrollTop);
		});

		boardEl.empty();
		if (input.total === 0) {
			boardEl.createDiv({ cls: 'tasklines-empty', text: 'No checkbox tasks in the notes this base selects.' });
			return;
		}
		for (const column of input.columns) this.drawColumn(column, input);

		boardEl.scrollLeft = scrollLeft;
		boardEl.querySelectorAll<HTMLElement>('.tasklines-column-cards').forEach((el) => {
			const top = el.dataset.column ? columnScroll.get(el.dataset.column) : undefined;
			if (top) el.scrollTop = top;
		});
		if (!this.restoreMoveFocus() && focusCard && focusKey) this.focusIn(focusCard, focusKey);
	}

	private drawColumn(column: BoardColumn<ViewRow>, input: BoardInput): void {
		const n = column.rows.length;
		const colEl = this.el.createDiv({ cls: 'tasklines-column' });
		colEl.toggleClass('is-locked', column.target === null);
		const head = colEl.createDiv({ cls: 'tasklines-column-head', attr: { role: 'heading', 'aria-level': '3', tabindex: '-1' } });
		head.dataset.column = column.key;
		// The list is named by the title (aria-labelledby): Obsidian shows an aria-label as a
		// tooltip, which would pop up over every card.
		const titleId = `tasklines-column-${++columnCount}`;
		head.createSpan({ cls: 'tasklines-column-title', text: column.label, attr: { id: titleId } });
		// Hidden words, not aria-label: Obsidian shows an aria-label as a tooltip.
		const count = head.createSpan({ cls: 'tasklines-column-count', text: String(n) });
		count.createSpan({ cls: 'tasklines-sr-only', text: n === 1 ? ' task' : ' tasks' });
		if (n) head.setAttr('title', formatSummary(summarize(column.rows, input.today)));
		if (input.selection?.active) drawGroupSelect(head, column.rows.map((r) => r.task), input.selection, column.label);
		if (column.note) colEl.createDiv({ cls: 'tasklines-column-note', text: column.note });

		const scroll = colEl.createDiv({ cls: 'tasklines-column-cards' });
		scroll.dataset.column = column.key;
		const list = scroll.createDiv({ cls: 'tasklines-card-list', attr: { role: 'list', 'aria-labelledby': titleId } });

		if (column.target !== null) {
			const accepts = (ev: DragEvent) => this.dragged !== null && !!ev.dataTransfer?.types.includes(DRAG_TYPE) && input.moveFor(this.dragged, column) !== null;
			colEl.addEventListener('dragover', (ev) => {
				if (!accepts(ev)) return;
				ev.preventDefault();
				if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
				colEl.addClass('is-drop-target');
			});
			colEl.addEventListener('dragleave', (ev) => {
				const to = ev.relatedTarget as Node | null;
				if (!to || !colEl.contains(to)) colEl.removeClass('is-drop-target');
			});
			colEl.addEventListener('drop', (ev) => {
				colEl.removeClass('is-drop-target');
				if (!accepts(ev) || !this.dragged) return;
				ev.preventDefault();
				ev.stopPropagation();
				void this.doMove(this.dragged, column);
			});
		}

		const limitKey = `${input.field}:${column.key}`;
		const limit = this.limits.get(limitKey) ?? CARD_PAGE;
		for (const row of column.rows.slice(0, limit)) {
			const card = this.drawCard(list, row, input);
			if (input.touch || input.selection?.active) continue; // phones move cards with the menu; select mode doesn't drag
			card.draggable = true;
			card.addEventListener('dragstart', (ev) => {
				if (!ev.dataTransfer) return;
				this.dragged = row.task;
				ev.dataTransfer.setData(DRAG_TYPE, cardKey(row.task));
				ev.dataTransfer.effectAllowed = 'move';
				card.addClass('is-dragging');
			});
			card.addEventListener('dragend', () => {
				this.dragged = null;
				card.removeClass('is-dragging');
				this.el.querySelectorAll('.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
				// Apply a redraw that was held back during the drag.
				if (this.deferred && this.input) this.render(this.input);
			});
		}
		if (n > limit) {
			const more = scroll.createEl('button', { cls: 'tasklines-btn tasklines-more', text: `Show ${Math.min(CARD_PAGE, n - limit)} more` });
			more.addEventListener('click', () => {
				this.limits.set(limitKey, limit + CARD_PAGE);
				if (this.input) this.render(this.input);
			});
		}
		if (n === 0) scroll.createDiv({ cls: 'tasklines-column-empty', text: column.target && !input.selection?.active ? 'Drop tasks here' : 'No tasks' });
	}

	private drawCard(parent: HTMLElement, row: ViewRow, input: BoardInput): HTMLElement {
		const { task } = row;
		const kind = statusKind(task.status);
		const card = parent.createDiv({ cls: `tasklines-card tasklines-status-${kind}`, attr: { role: 'listitem' } });
		card.dataset.key = cardKey(task);

		const top = card.createDiv({ cls: 'tasklines-card-top' });
		const open = kind !== 'done' && kind !== 'cancelled';
		if (input.selection?.active) drawSelectBox(top, card, task, input.selection);
		else {
			const box = top.createEl('input', {
				type: 'checkbox',
				cls: 'task-list-item-checkbox tasklines-checkbox',
				attr: { 'aria-label': kind === 'done' || kind === 'cancelled' ? `Reopen: ${task.text}` : `Complete: ${task.text}`, 'data-task': task.status, 'data-focus-key': 'check' },
			});
			if (task.recurrence && open && !input.tasksPluginAvailable) {
				box.addClass('tasklines-needs-tasks');
				box.setAttr('title', 'Completing a recurring task needs the Tasks plugin (7.2.0 or later). Open the note to complete it there.');
			}
			box.checked = kind !== 'todo';
			box.indeterminate = kind === 'in-progress';
			box.addEventListener('click', (ev) => {
				ev.preventDefault(); // shows the note's state, which changes only after the write
				// Marked busy rather than disabled: disabling the focused checkbox drops keyboard focus.
				if (box.getAttr('aria-disabled') === 'true') return;
				box.setAttr('aria-disabled', 'true');
				void input.toggleTask(task).finally(() => box.removeAttribute('aria-disabled'));
			});
			const link = top.createEl('a', { text: task.text || '(empty)', href: '#', cls: 'tasklines-open tasklines-card-text', attr: { title: task.text, draggable: 'false' } });
			link.setAttr('aria-label', `${task.text} — open ${task.path} at line ${task.line + 1}`);
			link.dataset.focusKey = 'open';
			link.addEventListener('click', (ev) => {
				ev.preventDefault();
				input.openTask(task.path, task.line, ev.metaKey || ev.ctrlKey);
			});
			const menuBtn = top.createEl('button', {
				cls: 'clickable-icon tasklines-card-menu',
				text: '⋯',
				attr: { 'aria-label': `Move: ${task.text}`, 'aria-haspopup': 'menu', 'data-focus-key': 'menu' },
			});
			menuBtn.addEventListener('click', (ev) => {
				ev.preventDefault();
				// The menu closes on a click outside it; this click must not count as one.
				ev.stopPropagation();
				const from = input.columns.find((c) => c.rows.includes(row));
				input.showMenu(
					menuBtn,
					ev,
					input.columns
						.filter((c) => c.target !== null)
						.map((c) => ({
							label: `Move to ${c.label}`,
							disabled: input.moveFor(task, c) === null,
							run: () => {
								this.refocus = { key: cardKey(task), from: from?.key ?? '', index: from ? from.rows.indexOf(row) : 0, until: Date.now() + 5000 };
								void this.doMove(task, c);
							},
						})),
				);
			});
		}

		const meta = card.createDiv({ cls: 'tasklines-card-meta' });
		meta.createSpan({ cls: 'tasklines-card-note', text: row.noteName });
		if (task.due && input.field !== 'due') {
			const overdue = open && task.due < input.today;
			const due = meta.createSpan({ cls: `tasklines-card-due${overdue ? ' is-overdue' : ''}`, text: `📅 ${task.due}` });
			// Red alone doesn't reach a screen reader.
			if (overdue) due.createSpan({ cls: 'tasklines-sr-only', text: ' (overdue)' });
		}
		const mark = PRIORITY_MARK[task.priority];
		if (mark && input.field !== 'priority') meta.createSpan({ text: mark, attr: { role: 'img', 'aria-label': `${task.priority} priority`, title: `${task.priority} priority` } });
		if (task.recurrence) meta.createSpan({ text: '🔁', attr: { role: 'img', title: `Repeats ${task.recurrence}`, 'aria-label': `Repeats ${task.recurrence}` } });
		return card;
	}

	private focusIn(key: string, focusKey: string): boolean {
		const card = Array.from(this.el.querySelectorAll<HTMLElement>('.tasklines-card')).find((c) => c.dataset.key === key);
		const target = Array.from(card?.querySelectorAll<HTMLElement>('[data-focus-key]') ?? []).find((e) => e.dataset.focusKey === focusKey);
		if (target) reveal(target);
		return !!target;
	}

	/**
	 * After a menu move, follow the card to its new column. If it is not shown there (filtered
	 * out, or past the column's "Show more"), focus the next card where it was, or that column.
	 */
	private restoreMoveFocus(): boolean {
		const r = this.refocus;
		if (!r) return false;
		if (Date.now() > r.until) {
			this.refocus = null;
			return false;
		}
		const card = Array.from(this.el.querySelectorAll<HTMLElement>('.tasklines-card')).find((c) => c.dataset.key === r.key);
		const stillThere = card?.closest<HTMLElement>('.tasklines-column-cards')?.dataset.column === r.from;
		// The first redraw may come before the write lands; keep waiting while it is still in place.
		if (card && stillThere) return this.focusIn(r.key, 'menu');
		this.refocus = null;
		if (card) return this.focusIn(r.key, 'menu');
		const from = Array.from(this.el.querySelectorAll<HTMLElement>('.tasklines-column-cards')).find((c) => c.dataset.column === r.from);
		const cards = from ? Array.from(from.querySelectorAll<HTMLElement>('.tasklines-card')) : [];
		const next = cards[Math.min(r.index, cards.length - 1)];
		const target = next?.querySelector<HTMLElement>('[data-focus-key="menu"]') ?? this.el.querySelector<HTMLElement>(`.tasklines-column-head[data-column="${r.from}"]`);
		if (target) reveal(target);
		return !!target;
	}
}

/**
 * Focus a control on the board, first bringing its whole column (and card) into view. Focusing
 * alone scrolls only as far as the control itself, which leaves a column half off screen.
 */
function reveal(el: HTMLElement): void {
	el.closest<HTMLElement>('.tasklines-column')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	el.closest<HTMLElement>('.tasklines-card')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	el.focus({ preventScroll: true });
}
