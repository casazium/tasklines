import { App, Modal, Setting } from 'obsidian';
import { PRIORITY_ORDER } from './query.ts';
import type { Priority } from './parser.ts';
import type { NewTask } from './writeback.ts';

export interface NoteChoice {
	path: string;
	label: string;
}

/** Small form: task text, target note, optional due date and priority. */
export class AddTaskModal extends Modal {
	private task: NewTask = { text: '' };
	private path: string;

	constructor(
		app: App,
		private notes: NoteChoice[],
		defaultPath: string,
		private onSubmit: (path: string, task: NewTask) => void,
	) {
		super(app);
		this.path = defaultPath;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle('New task');

		const submit = () => {
			if (!this.task.text.trim()) return;
			this.close();
			this.onSubmit(this.path, this.task);
		};

		new Setting(contentEl).setName('Task').addText((t) => {
			t.setPlaceholder('What needs doing?').onChange((v) => (this.task.text = v));
			// The phone keyboard's action key then says Done and adds the task, which the
			// keyboard would otherwise hide.
			t.inputEl.setAttr('enterkeyhint', 'done');
			t.inputEl.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') {
					ev.preventDefault();
					submit();
				}
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(contentEl)
			.setName('Note')
			.setDesc('Added after the note’s last task, in the same style.')
			.addDropdown((d) => {
				for (const n of this.notes) d.addOption(n.path, n.label);
				d.setValue(this.path).onChange((v) => (this.path = v));
			});
		new Setting(contentEl).setName('Due').addText((t) => {
			t.inputEl.type = 'date';
			t.onChange((v) => (this.task.due = v || undefined));
		});
		new Setting(contentEl).setName('Priority').addDropdown((d) => {
			for (const p of PRIORITY_ORDER) d.addOption(p, p === 'none' ? '(none)' : p);
			d.setValue('none').onChange((v) => (this.task.priority = v as Priority));
		});
		new Setting(contentEl).addButton((b) => b.setButtonText('Add task').setCta().onClick(submit));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
