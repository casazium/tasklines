// In-view toolbar for task-level filter, sort and group. The query it edits is saved
// in the .base view config by the adapter, so each view keeps its own preset.

import { activeQueryCount, DEFAULT_QUERY, normalizeTag, PRIORITY_ORDER, STATUS_KINDS, STATUS_LABELS, TASK_GROUP_KEYS, TASK_SORT_KEYS, type DuePreset, type TaskQuery } from './query.ts';

export interface PropChoice {
	id: string;
	label: string;
}

const DUE_LABELS: Record<DuePreset, string> = {
	any: 'Any due date',
	overdue: 'Overdue',
	today: 'Due today',
	next7: 'Due in next 7 days',
	next30: 'Due in next 30 days',
	has: 'Has a due date',
	none: 'No due date',
	range: 'Due between…',
};
const SORT_LABELS: Record<string, string> = {
	due: 'Due',
	scheduled: 'Scheduled',
	start: 'Start',
	created: 'Created',
	done: 'Done date',
	priority: 'Priority',
	status: 'Status',
	text: 'Task text',
	note: 'Note name',
	position: 'Base order',
};
const GROUP_LABELS: Record<string, string> = {
	bases: 'Base grouping',
	none: 'No grouping',
	note: 'Note',
	section: 'Section',
	status: 'Status',
	due: 'Due bucket',
	priority: 'Priority',
	tag: 'Tag',
};

export class TaskToolbar {
	private el: HTMLElement;
	private query: TaskQuery;
	private props: PropChoice[] = [];
	private textTimer: number | undefined;
	/** On phones the controls fold behind one button so the tasks keep the screen. */
	private collapsible: boolean;
	private expanded: boolean;
	/** The board's columns take the place of grouping, so it has no group control. */
	private showGroup: boolean;
	/** Starts select mode for bulk actions, if the view has it. */
	private onSelect: (() => void) | undefined;
	/** Select mode is on: the Select button shows as pressed, and pressing it again leaves. */
	private selecting = false;

	constructor(
		parent: HTMLElement,
		query: TaskQuery,
		private onChange: (q: TaskQuery) => void,
		private onAdd: () => void,
		options: { collapsible?: boolean; showGroup?: boolean; onSelect?: () => void } = {},
	) {
		this.el = parent.createDiv({ cls: 'tasklines-toolbar' });
		this.query = query;
		this.collapsible = options.collapsible ?? false;
		this.expanded = !this.collapsible;
		this.showGroup = options.showGroup ?? true;
		this.onSelect = options.onSelect;
		this.build();
	}

	/** Sync from the saved config. Skipped while the user is typing in the toolbar. */
	update(query: TaskQuery, props: PropChoice[]): void {
		const propsChanged = props.map((p) => p.id + p.label).join() !== this.props.map((p) => p.id + p.label).join();
		const queryChanged = JSON.stringify(query) !== JSON.stringify(this.query);
		if (!propsChanged && !queryChanged) return;
		if (this.el.contains(document.activeElement) && !propsChanged) return;
		this.props = props;
		this.query = query;
		this.build();
	}

	private set(patch: Partial<TaskQuery>, rebuild = true): void {
		this.query = { ...this.query, ...patch };
		if (rebuild) this.build();
		this.onChange(this.query);
	}

	private setLater(patch: Partial<TaskQuery>): void {
		window.clearTimeout(this.textTimer);
		this.textTimer = window.setTimeout(() => this.set(patch, false), 300);
	}

	private build(): void {
		const q = this.query;
		this.el.empty();
		this.el.toggleClass('is-collapsed', !this.expanded);

		if (this.collapsible) {
			// Compact header: one button for all controls, plus New task.
			const header = this.el.createDiv({ cls: 'tasklines-toolbar-row tasklines-toolbar-header' });
			const active = activeQueryCount(this.showGroup ? q : { ...q, group: DEFAULT_QUERY.group });
			const toggle = header.createEl('button', {
				cls: `tasklines-btn tasklines-filter-toggle${active ? ' is-active' : ''}`,
				text: `${this.expanded ? '▾' : '▸'} ${this.showGroup ? 'Filter, sort, group' : 'Filter, sort'}${active ? ` (${active})` : ''}`,
				attr: { 'aria-expanded': String(this.expanded) },
			});
			toggle.addEventListener('click', () => {
				this.expanded = !this.expanded;
				this.build();
			});
			this.selectButton(header);
			const add = header.createEl('button', { cls: 'tasklines-btn mod-cta tasklines-add', text: 'New task', attr: { 'aria-label': 'Add a new task' } });
			add.addEventListener('click', () => this.onAdd());
			if (!this.expanded) return;
		}

		// Row 1: status and priority chips.
		const chips = this.el.createDiv({ cls: 'tasklines-toolbar-row' });
		this.chipSet(chips, 'Status', STATUS_KINDS, q.statuses, (s) => STATUS_LABELS[s] ?? s, (v) => this.set({ statuses: v }));
		this.chipSet(chips, 'Priority', PRIORITY_ORDER, q.priorities, (p) => p[0]?.toUpperCase() + p.slice(1), (v) => this.set({ priorities: v }));

		// Row 2: due, tags, text.
		const filters = this.el.createDiv({ cls: 'tasklines-toolbar-row' });
		const due = this.select(filters, 'Due', Object.entries(DUE_LABELS), q.due);
		due.addEventListener('change', () => this.set({ due: due.value as DuePreset }));
		if (q.due === 'range') {
			for (const key of ['dueFrom', 'dueTo'] as const) {
				const input = filters.createEl('input', { type: 'date', cls: 'tasklines-date', attr: { 'aria-label': key === 'dueFrom' ? 'Due from' : 'Due to' } });
				input.value = q[key];
				input.addEventListener('change', () => this.set({ [key]: input.value }, false));
			}
		}
		const doneChoices: Array<[string, string]> = [
			['all', 'All completed'],
			['0', 'Completed today'],
			['7', 'Completed in last 7 days'],
			['30', 'Completed in last 30 days'],
		];
		const doneValue = q.doneWithinDays === null ? 'all' : String(q.doneWithinDays);
		const doneSel = this.select(filters, 'Completed tasks', doneChoices, doneValue);
		doneSel.addEventListener('change', () => this.set({ doneWithinDays: doneSel.value === 'all' ? null : Number(doneSel.value) }));
		const tags = filters.createEl('input', { type: 'text', cls: 'tasklines-input', attr: { placeholder: 'Tags: #work #home', 'aria-label': 'Filter by tags' } });
		tags.value = q.tags.join(' ');
		tags.addEventListener('input', () => this.setLater({ tags: tags.value.split(/[\s,]+/).map(normalizeTag).filter(Boolean) }));
		const text = filters.createEl('input', { type: 'search', cls: 'tasklines-input', attr: { placeholder: 'Search task text', 'aria-label': 'Search task text' } });
		text.value = q.text;
		text.addEventListener('input', () => this.setLater({ text: text.value }));

		// Row 3: sort keys and group.
		const order = this.el.createDiv({ cls: 'tasklines-toolbar-row' });
		order.createSpan({ cls: 'tasklines-label', text: 'Sort' });
		const sortChoices: Array<[string, string]> = [
			...TASK_SORT_KEYS.map((k): [string, string] => [k, SORT_LABELS[k] ?? k]),
			...this.props.map((p): [string, string] => [`prop:${p.id}`, p.label]),
		];
		q.sort.forEach((s, i) => {
			const wrap = order.createSpan({ cls: 'tasklines-sort-key' });
			const sel = this.select(wrap, `Sort key ${i + 1}`, sortChoices, s.key);
			sel.addEventListener('change', () => this.set({ sort: q.sort.map((x, j) => (j === i ? { ...x, key: sel.value } : x)) }));
			const dir = wrap.createEl('button', { cls: 'tasklines-btn', text: s.desc ? '↓' : '↑', attr: { 'aria-label': s.desc ? 'Descending' : 'Ascending' } });
			dir.addEventListener('click', () => this.set({ sort: q.sort.map((x, j) => (j === i ? { ...x, desc: !x.desc } : x)) }));
			const rm = wrap.createEl('button', { cls: 'tasklines-btn', text: '×', attr: { 'aria-label': 'Remove sort key' } });
			rm.addEventListener('click', () => this.set({ sort: q.sort.filter((_, j) => j !== i) }));
		});
		if (q.sort.length < 3) {
			const add = order.createEl('button', { cls: 'tasklines-btn', text: q.sort.length ? '+ then by' : '+ add sort' });
			add.addEventListener('click', () => this.set({ sort: [...q.sort, { key: q.sort.length ? 'priority' : 'due', desc: false }] }));
		}

		if (this.showGroup) {
			// Label and dropdown stay together when the row wraps.
			const groupWrap = order.createSpan({ cls: 'tasklines-control' });
			groupWrap.createSpan({ cls: 'tasklines-label', text: 'Group' });
			const groupChoices: Array<[string, string]> = [
				...TASK_GROUP_KEYS.map((k): [string, string] => [k, GROUP_LABELS[k] ?? k]),
				...this.props.map((p): [string, string] => [`prop:${p.id}`, p.label]),
			];
			const group = this.select(groupWrap, 'Group tasks by', groupChoices, q.group);
			group.addEventListener('change', () => this.set({ group: group.value }));
		}

		if (!this.collapsible) {
			const add = order.createEl('button', { cls: 'tasklines-btn mod-cta tasklines-add', text: 'New task', attr: { 'aria-label': 'Add a new task' } });
			add.addEventListener('click', () => this.onAdd());
			this.selectButton(order);
		}
		const reset = order.createEl('button', { cls: 'tasklines-btn tasklines-reset', text: 'Reset' });
		reset.addEventListener('click', () =>
			this.set({ statuses: [], priorities: [], due: 'any', dueFrom: '', dueTo: '', tags: [], text: '', doneWithinDays: null, sort: [], group: 'bases' }),
		);
	}

	private selectButton(parent: HTMLElement): void {
		if (!this.onSelect) return;
		const b = parent.createEl('button', { cls: 'tasklines-btn tasklines-select-mode', text: 'Select', attr: { 'data-focus-key': 'select' } });
		this.showSelecting(b);
		b.addEventListener('click', () => this.onSelect?.());
	}

	/** Show whether select mode is on, on every Select button (the header and the folded toolbar both have one). */
	setSelecting(on: boolean): void {
		this.selecting = on;
		this.el.querySelectorAll<HTMLElement>('.tasklines-select-mode').forEach((b) => this.showSelecting(b));
	}

	private showSelecting(b: HTMLElement): void {
		b.toggleClass('is-active', this.selecting);
		b.setAttr('aria-pressed', String(this.selecting));
		b.setAttr('aria-label', this.selecting ? 'Leave select mode' : 'Select tasks to change several at once');
	}

	/** Put keyboard focus back on Select (after leaving select mode). */
	focusSelect(): void {
		this.el.querySelector<HTMLElement>('.tasklines-select-mode')?.focus();
	}

	private chipSet<T extends string>(parent: HTMLElement, label: string, all: readonly T[], selected: T[], name: (v: T) => string, apply: (v: T[]) => void): void {
		const set = parent.createSpan({ cls: 'tasklines-chips', attr: { role: 'group', 'aria-label': label } });
		set.createSpan({ cls: 'tasklines-label', text: label });
		for (const v of all) {
			const on = selected.includes(v);
			const chip = set.createEl('button', { cls: `tasklines-chip${on ? ' is-active' : ''}`, text: name(v), attr: { 'aria-pressed': String(on) } });
			chip.addEventListener('click', () => apply(on ? selected.filter((s) => s !== v) : [...selected, v]));
		}
	}

	private select(parent: HTMLElement, label: string, choices: Array<[string, string]>, value: string): HTMLSelectElement {
		const sel = parent.createEl('select', { cls: 'dropdown tasklines-select', attr: { 'aria-label': label } });
		for (const [v, text] of choices) sel.createEl('option', { value: v, text });
		// Keep a saved value visible even if its property is not in this base any more.
		if (!choices.some(([v]) => v === value)) sel.createEl('option', { value, text: `${value} (missing)` });
		sel.value = value;
		return sel;
	}
}
