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
		this.scroller = parent.createDiv({ cls: 'tasklines-scroller' });
		this.header = this.scroller.createDiv({ cls: 'tasklines-header' });
		this.spacer = this.scroller.createDiv({ cls: 'tasklines-spacer' });
		this.windowEl = this.spacer.createDiv({ cls: 'tasklines-window' });
		this.scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
		// Redraw when the pane is resized (more rows may fit).
		this.resize = new ResizeObserver(() => this.schedule());
		this.resize.observe(this.scroller);
	}

	/** Replace the items. Keeps the scroll position so refreshes do not jump. */
	setItems(count: number, renderItem: (index: number, el: HTMLElement) => void): void {
		this.count = count;
		this.renderItem = renderItem;
		this.spacer.style.height = `${count * this.rowHeight}px`;
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
		this.windowEl.style.transform = `translateY(${start * this.rowHeight}px)`;
		this.windowEl.empty();
		for (let i = start; i < end; i++) {
			const el = this.windowEl.createDiv({ cls: 'tasklines-item' });
			el.style.height = `${this.rowHeight}px`;
			this.renderItem(i, el);
		}
	}

	destroy(): void {
		if (this.frame) window.cancelAnimationFrame(this.frame);
		this.resize.disconnect();
		this.scroller.remove();
	}
}
