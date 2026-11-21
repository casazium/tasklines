// Fixed-row-height virtual list: only rows inside the scroll viewport (plus overscan)
// exist in the DOM, so 10,000 tasks cost the same to show as 40.

export const ROW_HEIGHT = 30;
/** Taller rows on phones and tablets so checkboxes and cells are easy to tap. */
export const TOUCH_ROW_HEIGHT = 40;
const OVERSCAN = 10;

export class VirtualList {
	readonly scroller: HTMLElement;
	readonly header: HTMLElement;
	private spacer: HTMLElement;
	private windowEl: HTMLElement;
	private count = 0;
	private renderItem: (index: number, el: HTMLElement) => void = () => {};
	private frame = 0;
	private drawn: [number, number] = [-1, -1];
	private resize: ResizeObserver;
	private rowHeight: number;

	constructor(parent: HTMLElement, rowHeight = ROW_HEIGHT) {
		this.rowHeight = rowHeight;
		// A table to assistive tech. Only the rows near the viewport exist, so the full row count
		// and each row's position are given explicitly (header is row 1).
		this.scroller = parent.createDiv({ cls: 'tasklines-scroller', attr: { role: 'table', 'aria-label': 'Tasks' } });
		this.header = this.scroller.createDiv({ cls: 'tasklines-header' });
		this.spacer = this.scroller.createDiv({ cls: 'tasklines-spacer' });
		this.windowEl = this.spacer.createDiv({ cls: 'tasklines-window' });
		this.scroller.setCssProps({ '--tasklines-row-height': `${rowHeight}px` });
		this.scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
		// Redraw when the pane is resized (more rows may fit).
		this.resize = new ResizeObserver(() => this.schedule());
		this.resize.observe(this.scroller);
	}

	/** Replace the items. Keeps the scroll position so refreshes do not jump. */
	setItems(count: number, renderItem: (index: number, el: HTMLElement) => void): void {
		this.count = count;
		this.renderItem = renderItem;
		this.scroller.setAttr('aria-rowcount', String(count + 1));
		this.spacer.setCssProps({ '--tasklines-total-height': `${count * this.rowHeight}px` });
		this.drawn = [-1, -1];
		this.draw();
	}

	private schedule(): void {
		if (this.frame) return;
		this.frame = window.requestAnimationFrame(() => {
			this.frame = 0;
			this.draw();
		});
	}

	private draw(): void {
		const viewport = this.scroller.clientHeight || 600;
		const top = Math.max(0, this.scroller.scrollTop - this.header.offsetHeight);
		const start = Math.max(0, Math.floor(top / this.rowHeight) - OVERSCAN);
		const end = Math.min(this.count, Math.ceil((top + viewport) / this.rowHeight) + OVERSCAN);
		if (start === this.drawn[0] && end === this.drawn[1]) return;
		this.drawn = [start, end];
		this.windowEl.setCssProps({ '--tasklines-offset': `${start * this.rowHeight}px` });
		// Redrawing replaces the rows; keep keyboard focus on the same control of the same item.
		const focused = this.windowEl.ownerDocument.activeElement;
		const inList = focused?.instanceOf(HTMLElement) && this.windowEl.contains(focused);
		const itemKey = inList ? focused.closest<HTMLElement>('.tasklines-item')?.dataset.key : undefined;
		// A control inside a cell (an open editor) counts as its cell.
		const focusKey = inList ? focused.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey : undefined;
		this.windowEl.empty();
		for (let i = start; i < end; i++) {
			const el = this.windowEl.createDiv({ cls: 'tasklines-item', attr: { 'aria-rowindex': String(i + 2) } });
			this.renderItem(i, el);
		}
		if (itemKey && focusKey) {
			const item = Array.from(this.windowEl.children).find((c) => c.instanceOf(HTMLElement) && c.dataset.key === itemKey);
			const target = Array.from(item?.querySelectorAll('[data-focus-key]') ?? []).find((e): e is HTMLElement => e.instanceOf(HTMLElement) && e.dataset.focusKey === focusKey);
			target?.focus({ preventScroll: true });
		}
	}

	destroy(): void {
		if (this.frame) window.cancelAnimationFrame(this.frame);
		this.resize.disconnect();
		this.scroller.remove();
	}
}
