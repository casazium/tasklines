// The action bar for bulk actions: shown in select mode, above the tasks. DOM only; the adapter
// runs the actions. Uses only types from Obsidian.

import type { BulkAction, CopyMode } from './bulk.ts';
import type { CalendarField } from './calendar.ts';
import { statusDefs, type Priority } from './parser.ts';
import { PRIORITY_ORDER } from './query.ts';

export interface SelectionBarHandlers {
	/** Run an action on the selected tasks. `pickDate` asks for a date first. */
	run: (action: BulkAction | 'pick-date', verb: string) => void;
	selectAll: () => void;
	clear: () => void;
	undo: () => void;
	cancel: () => void;
	exit: () => void;
	/** Which date the date menu changes. */
	setDateField: (field: CalendarField) => void;
	copy: (mode: CopyMode) => void;
}

export interface SelectionBarState {
	active: boolean;
	selected: number;
	/** Tasks shown (after filters), for "Select all". */
	shown: number;
	/** The date field date actions change: due, or the calendar's field, unless changed in the bar. */
	dateField: CalendarField;
	/** A batch is being written: everything but Cancel is off. */
	busy: { done: number; total: number } | null;
	/** Label of the last batch that can be undone, if any. */
	undoLabel: string | null;
}

const DATE_LABEL = { due: 'Due', scheduled: 'Scheduled', start: 'Start' } as const;
const cap = (s: string) => (s[0]?.toUpperCase() ?? '') + s.slice(1);

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
		// Keep keyboard focus on the same control when the bar is redrawn.
		const active = document.activeElement;
		const focusKey = active instanceof HTMLElement && this.el.contains(active) ? active.dataset.focusKey : undefined;
		this.draw(state);
		if (focusKey) this.el.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
	}

	private draw(state: SelectionBarState): void {
		this.el.empty();
		this.el.toggle(state.active);
		if (!state.active) return;
		const h = this.handlers;
		const row = this.el.createDiv({ cls: 'tasklines-toolbar-row' });
		this.count = row.createSpan({ cls: 'tasklines-selection-count', attr: { 'aria-live': 'polite' } });

		if (state.busy) {
			this.count.setText(`Working… ${state.busy.done} of ${state.busy.total}`);
			const cancel = row.createEl('button', { cls: 'tasklines-btn', text: 'Cancel', attr: { 'data-focus-key': 'bulk-cancel' } });
			cancel.addEventListener('click', () => h.cancel());
			return;
		}
		this.count.setText(`${state.selected} selected`);

		const button = (text: string, onClick: () => void, needsSelection = true, cls = 'tasklines-btn') => {
			const b = row.createEl('button', { cls, text, attr: { 'data-focus-key': `bulk-${text}` } });
			if (needsSelection) {
				b.dataset.needsSelection = '1';
				b.disabled = state.selected === 0;
			}
			b.addEventListener('click', onClick);
			return b;
		};
		const menu = (label: string, choices: Array<[string, string]>, onPick: (value: string, text: string) => void) => {
			const sel = row.createEl('select', { cls: 'dropdown tasklines-select', attr: { 'aria-label': label, 'data-focus-key': `bulk-${label}` } });
			sel.dataset.needsSelection = '1';
			sel.disabled = state.selected === 0;
			sel.createEl('option', { value: '', text: label });
			for (const [value, text] of choices) sel.createEl('option', { value, text });
			sel.addEventListener('change', () => {
				const value = sel.value;
				const text = sel.selectedOptions[0]?.text ?? value;
				sel.value = '';
				if (value) onPick(value, text);
			});
		};

		button('Complete', () => h.run({ kind: 'complete' }, 'Completed'), true, 'tasklines-btn mod-cta');
		button('Reopen', () => h.run({ kind: 'reopen' }, 'Reopened'));
		menu('Status', statusDefs().map((d) => [d.char, `[${d.char}] ${d.name}`]), (char, text) => h.run({ kind: 'status', char }, `Set status ${text} on`));
		menu(
			'Priority',
			PRIORITY_ORDER.map((p): [string, string] => [p, p === 'none' ? 'No priority' : cap(p)]),
			(p, text) => h.run({ kind: 'priority', value: p as Priority }, `Set priority ${text} on`),
		);
		const field = state.dateField;
		const fieldSel = row.createEl('select', { cls: 'dropdown tasklines-select', attr: { 'aria-label': 'Date to change', 'data-focus-key': 'bulk-date-field' } });
		for (const f of ['due', 'scheduled', 'start'] as const) fieldSel.createEl('option', { value: f, text: `${DATE_LABEL[f]} date` });
		fieldSel.value = field;
		fieldSel.addEventListener('change', () => h.setDateField(fieldSel.value as CalendarField));
		const name = DATE_LABEL[field].toLowerCase();
		menu(
			'Change date',
			[
				['today', 'Today'],
				['tomorrow', 'Tomorrow'],
				['+1', 'One day later'],
				['+7', 'One week later'],
				['pick', 'Pick a date…'],
				['remove', `Remove ${name} date`],
			],
			(choice, text) => {
				if (choice === 'pick') return h.run('pick-date', `Rescheduled`);
				if (choice === 'remove') return h.run({ kind: 'set-date', field, value: null }, `Removed the ${name} date from`);
				if (choice === '+1' || choice === '+7') return h.run({ kind: 'shift-date', field, days: Number(choice) }, `Moved ${text.toLowerCase()}:`);
				// Today and Tomorrow are resolved when the batch runs.
				return h.run({ kind: 'set-date', field, value: choice }, `Rescheduled to ${text.toLowerCase()}:`);
			},
		);
		menu(
			'Copy',
			[
				['links', 'List with links'],
				['lines', 'Task lines'],
			],
			(mode) => h.copy(mode as CopyMode),
		);
		button(`Select all ${state.shown}`, () => h.selectAll(), false);
		button('Clear', () => h.clear());
		if (state.undoLabel) button(`Undo: ${state.undoLabel}`, () => h.undo(), false);
		button('Done', () => h.exit(), false, 'tasklines-btn tasklines-selection-done');
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

/** "Select" (or "Unselect") for every task under a group, column or day heading. */
export function drawGroupSelect(parent: HTMLElement, tasks: Array<{ path: string; line: number; raw: string }>, sel: SelectionHooks, label: string): void {
	if (!tasks.length) return;
	const all = tasks.every((t) => sel.has(t));
	const b = parent.createEl('button', {
		cls: 'tasklines-btn tasklines-group-select',
		text: all ? 'Unselect' : 'Select',
		attr: { 'aria-label': `${all ? 'Unselect' : 'Select'} all in ${label || '(none)'}`, 'data-focus-key': `group-select:${label}` },
	});
	b.addEventListener('click', (ev) => {
		ev.stopPropagation();
		sel.setMany(tasks, !all);
	});
}
