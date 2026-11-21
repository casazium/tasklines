// The action bar for bulk actions: shown in select mode, above the tasks. DOM only; the adapter
// runs the actions. Uses only types from Obsidian.

import type { BulkAction, CopyMode } from './bulk.ts';
import type { CalendarField } from './calendar.ts';
import { statusDefs, type Priority } from './parser.ts';
import { PRIORITY_ORDER } from './query.ts';

export interface SelectionBarHandlers {
	/** Run an action on the selected tasks. `pick-date` asks for a date first. */
	run: (action: BulkAction | { kind: 'pick-date'; field: CalendarField }, verb: string) => void;
	selectAll: () => void;
	clear: () => void;
	undo: () => void;
	cancel: () => void;
	exit: () => void;
	copy: (mode: CopyMode) => void;
}

export interface SelectionBarState {
	active: boolean;
	selected: number;
	/** Tasks shown (after filters), for "Select all". */
	shown: number;
	/** The view's own date field (due, or the calendar's), listed first in the date menu. */
	dateField: CalendarField;
	/** A batch is being written: everything but Cancel is off. */
	busy: { done: number; total: number } | null;
	/** What Undo would put back (e.g. "3 tasks"), or null when there is nothing to undo. */
	undoLabel: string | null;
	/** Phones: the main action and the date menu, with the rest folded into More. */
	compact: boolean;
}

const DATE_LABEL = { due: 'Due', scheduled: 'Scheduled', start: 'Start' } as const;
const cap = (s: string) => (s[0]?.toUpperCase() ?? '') + s.slice(1);

type MenuItem = [value: string, text: string] | { group: string; items: Array<[value: string, text: string]> };

export class SelectionBar {
	readonly el: HTMLElement;
	private count: HTMLElement | null = null;
	private handlers: SelectionBarHandlers;

	constructor(parent: HTMLElement, before: HTMLElement, handlers: SelectionBarHandlers) {
		this.handlers = handlers;
		this.el = parent.createDiv({ cls: 'tasklines-selection-bar', attr: { role: 'toolbar', 'aria-label': 'Bulk actions' } });
		parent.insertBefore(this.el, before);
		this.el.hide();
	}

	/** Just the count, without rebuilding (ticking a task in select mode). */
	setCount(selected: number): void {
		this.count?.setText(`${selected} selected`);
		this.el.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('[data-needs-selection]').forEach((c) => (c.disabled = selected === 0));
	}

	focus(): void {
		this.el.querySelector<HTMLElement>('button:not([disabled]), select:not([disabled])')?.focus();
	}

	render(state: SelectionBarState): void {
		// Keep keyboard focus on the same control when the bar is redrawn; while a batch runs
		// every control but Cancel is off, so focus goes there.
		const active = document.activeElement;
		const inside = active instanceof HTMLElement && this.el.contains(active);
		const focusKey = inside ? active.dataset.focusKey : undefined;
		this.draw(state);
		if (!inside) return;
		const target = this.el.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey ?? '')}"]:not([disabled])`) ?? (state.busy ? this.el.querySelector<HTMLElement>('[data-focus-key="bulk-end"]') : null);
		target?.focus();
	}

	/**
	 * Always the same controls in the same places, so nothing moves under a finger: what is
	 * selected, then the actions, then Undo and Done (Cancel while a batch runs).
	 */
	private draw(state: SelectionBarState): void {
		this.el.empty();
		this.el.toggle(state.active);
		this.el.toggleClass('is-compact', state.compact);
		if (!state.active) return;
		const h = this.handlers;
		const busy = state.busy !== null;
		const row = this.el.createDiv({ cls: 'tasklines-toolbar-row' });

		const button = (parent: HTMLElement, text: string, key: string, onClick: () => void, opts: { needsSelection?: boolean; cls?: string; label?: string; off?: boolean } = {}) => {
			const b = parent.createEl('button', { cls: opts.cls ?? 'tasklines-btn', text, attr: { 'data-focus-key': `bulk-${key}` } });
			if (opts.label) b.setAttr('aria-label', opts.label);
			if (opts.needsSelection) b.dataset.needsSelection = '1';
			b.disabled = busy || opts.off === true || (opts.needsSelection === true && state.selected === 0);
			b.addEventListener('click', onClick);
			return b;
		};
		const menu = (parent: HTMLElement, label: string, items: MenuItem[], onPick: (value: string, text: string) => void, shown = label) => {
			const sel = parent.createEl('select', { cls: 'dropdown tasklines-select', attr: { 'aria-label': label, 'data-focus-key': `bulk-${label}` } });
			sel.dataset.needsSelection = '1';
			sel.disabled = busy || state.selected === 0;
			sel.createEl('option', { value: '', text: shown });
			for (const item of items) {
				if (Array.isArray(item)) sel.createEl('option', { value: item[0], text: item[1] });
				else {
					const group = sel.createEl('optgroup', { attr: { label: item.group } });
					for (const [value, text] of item.items) group.createEl('option', { value, text });
				}
			}
			sel.addEventListener('change', () => {
				const value = sel.value;
				const text = sel.selectedOptions[0]?.text ?? value;
				sel.value = '';
				if (value) onPick(value, text);
			});
		};

		// What is selected.
		const which = row.createDiv({ cls: 'tasklines-selection-group' });
		this.count = which.createSpan({ cls: 'tasklines-selection-count', attr: { 'aria-live': 'polite' } });
		this.count.setText(state.busy ? `Working… ${state.busy.done} of ${state.busy.total}` : `${state.selected} selected`);
		button(which, `Select all ${state.shown}`, 'select-all', () => h.selectAll(), { label: `Select all ${state.shown} shown tasks` });
		if (!state.compact) button(which, 'Clear', 'clear', () => h.clear(), { needsSelection: true, label: 'Clear the selection' });

		// What to do with it.
		const actions = row.createDiv({ cls: 'tasklines-selection-actions' });
		button(actions, 'Complete', 'complete', () => h.run({ kind: 'complete' }, 'Completed'), { needsSelection: true, cls: 'tasklines-btn mod-cta' });
		const statuses: Array<[string, string]> = statusDefs().map((d) => [d.char, `[${d.char}] ${d.name}`]);
		const priorities: Array<[string, string]> = PRIORITY_ORDER.map((p): [string, string] => [p, p === 'none' ? 'No priority' : cap(p)]);
		const copies: Array<[string, string]> = [
			['links', 'List with links'],
			['lines', 'Task lines (as written)'],
		];
		const runStatus = (char: string, text: string) => h.run({ kind: 'status', char }, `Set status ${text} on`);
		const runPriority = (p: string, text: string) => h.run({ kind: 'priority', value: p as Priority }, `Set priority ${text} on`);
		if (!state.compact) {
			button(actions, 'Reopen', 'reopen', () => h.run({ kind: 'reopen' }, 'Reopened'), { needsSelection: true });
			menu(actions, 'Status', statuses, runStatus);
			menu(actions, 'Priority', priorities, runPriority);
		}
		this.dateMenu(actions, state, menu);
		if (!state.compact) menu(actions, 'Copy', copies, (mode) => h.copy(mode as CopyMode));
		else {
			const prefix = (p: string, list: Array<[string, string]>): Array<[string, string]> => list.map(([v, t]) => [`${p}:${v}`, t]);
			menu(
				actions,
				'More',
				[
					['reopen', 'Reopen'],
					{ group: 'Status', items: prefix('status', statuses) },
					{ group: 'Priority', items: prefix('priority', priorities) },
					{ group: 'Copy', items: prefix('copy', copies) },
					['clear', 'Clear the selection'],
				],
				(value, text) => {
					const i = value.indexOf(':');
					const [kind, rest] = i < 0 ? [value, ''] : [value.slice(0, i), value.slice(i + 1)];
					if (kind === 'reopen') h.run({ kind: 'reopen' }, 'Reopened');
					else if (kind === 'status') runStatus(rest, text);
					else if (kind === 'priority') runPriority(rest, text);
					else if (kind === 'copy') h.copy(rest as CopyMode);
					else if (kind === 'clear') h.clear();
				},
			);
		}

		// Undo stays in place (off when there's nothing to undo), so the bar never changes shape.
		const end = row.createDiv({ cls: 'tasklines-selection-end' });
		button(end, 'Undo', 'undo', () => h.undo(), { off: state.undoLabel === null, label: state.undoLabel ? `Undo the last change (${state.undoLabel})` : 'Nothing to undo' });
		if (busy) button(end, 'Cancel', 'end', () => h.cancel(), { cls: 'tasklines-btn tasklines-selection-done' }).disabled = false;
		else button(end, 'Done', 'end', () => h.exit(), { cls: 'tasklines-btn tasklines-selection-done', label: 'Leave select mode' });
	}

	/** One date menu, grouped by date (the view's own first): "Due date → Tomorrow", "Scheduled date → Remove", … */
	private dateMenu(
		parent: HTMLElement,
		state: SelectionBarState,
		menu: (parent: HTMLElement, label: string, items: MenuItem[], onPick: (value: string, text: string) => void, shown?: string) => void,
	): void {
		const h = this.handlers;
		const fields = [state.dateField, ...(['due', 'scheduled', 'start'] as const).filter((f) => f !== state.dateField)];
		menu(
			parent,
			'Change date',
			fields.map((f) => ({
				group: `${DATE_LABEL[f]} date`,
				items: [
					[`${f}:today`, 'Today'],
					[`${f}:tomorrow`, 'Tomorrow'],
					[`${f}:+1`, 'One day later'],
					[`${f}:+7`, 'One week later'],
					[`${f}:pick`, 'Pick a date…'],
					[`${f}:remove`, `Remove ${DATE_LABEL[f].toLowerCase()} date`],
				],
			})),
			(value, text) => {
				const [f, choice] = value.split(':') as [CalendarField, string];
				const name = `the ${DATE_LABEL[f].toLowerCase()} date`;
				if (choice === 'pick') return h.run({ kind: 'pick-date', field: f }, `Set ${name} on`);
				if (choice === 'remove') return h.run({ kind: 'set-date', field: f, value: null }, `Removed ${name} from`);
				if (choice === '+1' || choice === '+7') return h.run({ kind: 'shift-date', field: f, days: Number(choice) }, `Moved ${name} ${text.toLowerCase()} on`);
				// Today and Tomorrow are resolved when the batch runs.
				return h.run({ kind: 'set-date', field: f, value: choice }, `Set ${name} to ${text.toLowerCase()} on`);
			},
			// A third of a phone's width fits "Date", not "Change date".
			state.compact ? 'Date' : 'Change date',
		);
	}
}

/** What the list, board and calendar need to draw select mode. Ticking toggles in place, without a redraw. */
export interface SelectionHooks {
	active: boolean;
	has: (task: { path: string; line: number; raw: string }) => boolean;
	/** `range`: Shift was held, so select (or unselect) everything from the last ticked task to this one. */
	toggle: (task: { path: string; line: number; raw: string }, selected: boolean, range?: boolean) => void;
	/** Select or unselect every task of a group, column or day. */
	setMany: (tasks: Array<{ path: string; line: number; raw: string }>, selected: boolean) => void;
}

/**
 * Select mode for one task: a selection checkbox in place of the completion checkbox (so one
 * control is never two things), and the text as plain text that also toggles. Returns the box.
 */
export function drawSelectBox(parent: HTMLElement, item: HTMLElement, task: { path: string; line: number; raw: string; text: string }, sel: SelectionHooks): HTMLElement {
	const box = parent.createEl('input', { type: 'checkbox', cls: 'tasklines-select-box', attr: { 'aria-label': `Select: ${task.text}`, 'data-focus-key': 'check' } });
	box.checked = sel.has(task);
	item.toggleClass('is-selected', box.checked);
	const set = (on: boolean, range: boolean) => {
		box.checked = on;
		item.toggleClass('is-selected', on);
		sel.toggle(task, on, range);
	};
	box.addEventListener('click', (ev) => set(box.checked, ev.shiftKey));
	const text = parent.createSpan({ cls: 'tasklines-select-text', text: task.text || '(empty)', attr: { title: task.text } });
	// Shift-click selects a range, not the words.
	text.addEventListener('mousedown', (ev) => {
		if (ev.shiftKey) ev.preventDefault();
	});
	text.addEventListener('click', (ev) => set(!box.checked, ev.shiftKey));
	return box;
}

/**
 * A checkbox for every task under a group, column or day heading: ticked when all are selected,
 * half-ticked when some are. Placed first, in line with the tasks' own boxes.
 */
export function drawGroupSelect(parent: HTMLElement, tasks: Array<{ path: string; line: number; raw: string }>, sel: SelectionHooks, label: string): void {
	if (!tasks.length) return;
	const n = tasks.filter((t) => sel.has(t)).length;
	// The label widens the tap target without moving the box.
	const wrap = createEl('label', { cls: 'tasklines-group-select' });
	parent.prepend(wrap);
	const box = wrap.createEl('input', {
		type: 'checkbox',
		cls: 'tasklines-select-box',
		attr: { 'aria-label': `Select all in ${label || '(none)'}`, 'data-focus-key': `group-select:${label}` },
	});
	box.checked = n === tasks.length;
	box.indeterminate = n > 0 && n < tasks.length;
	wrap.addEventListener('click', (ev) => ev.stopPropagation());
	box.addEventListener('click', () => sel.setMany(tasks, n !== tasks.length));
}
