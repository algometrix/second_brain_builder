import { App, Modal, Notice, TFile } from "obsidian";
import { NoteMode } from "../types";
import { createModeGrid, setModalTitle } from "../ui";

// ─── Folder Analysis Modal ───────────────────────────────────────

export class FolderAnalysisModal extends Modal {
	modes: NoteMode[];
	folderPath: string;
	folderName: string;
	onSubmit: (mode: NoteMode, extraContent: string) => void;
	selectedMode: NoteMode | null;
	extraValue: string;
	btnEls: { id: string; el: HTMLElement }[];
	submitBtnEl: HTMLButtonElement | null;

	constructor(
		app: App,
		modes: NoteMode[],
		folderPath: string,
		folderName: string,
		onSubmit: (mode: NoteMode, extraContent: string) => void,
	) {
		super(app);
		this.modes = modes;
		this.folderPath = folderPath;
		this.folderName = folderName;
		this.onSubmit = onSubmit;
		this.selectedMode = null;
		this.extraValue = "";
		this.btnEls = [];
		this.submitBtnEl = null;
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal", "ch-modal-wide");
		setModalTitle(this, "Analyze folder");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: `Analyzing: ${this.folderPath || "/"}` });
		wrapper.createDiv({ cls: "ch-hint", text: "All notes in this folder will be read as context." });

		wrapper.createDiv({ cls: "ch-label", text: "Analysis mode" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.pickMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });
		sep.createDiv({ cls: "ch-label", text: "Additional content (articles, context, instructions)" });
		const extraInput = sep.createEl("textarea", { cls: "ch-textarea ch-textarea-xl" });
		extraInput.placeholder = "Paste articles, blog posts, or extra context here...\n\nOptional for most modes: leave empty to analyze the existing notes as they are.";
		extraInput.rows = 8;
		extraInput.addEventListener("input", () => { this.extraValue = extraInput.value; });
		extraInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		this.submitBtnEl = btnRow.createEl("button", { text: "Select an analysis mode" });
		this.submitBtnEl.disabled = true;
		this.submitBtnEl.addClass("mod-cta");
		this.submitBtnEl.addEventListener("click", () => this.doSubmit());
	}

	pickMode(mode: NoteMode): void {
		this.selectedMode = mode;
		for (const b of this.btnEls) {
			b.el.toggleClass("is-selected", b.id === mode.id);
		}
		if (this.submitBtnEl) {
			this.submitBtnEl.disabled = false;
			this.submitBtnEl.setText(`Analyze - ${mode.name}`);
		}
	}

	doSubmit(): void {
		if (!this.selectedMode) {
			new Notice("Pick an analysis mode.");
			return;
		}
		this.close();
		this.onSubmit(this.selectedMode, this.extraValue.trim());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ─── Note Analysis Modal ─────────────────────────────────────────

export class NoteAnalysisModal extends Modal {
	modes: NoteMode[];
	file: TFile;
	onSubmit: (mode: NoteMode, extraContent: string) => void;
	selectedMode: NoteMode | null;
	extraValue: string;
	btnEls: { id: string; el: HTMLElement }[];
	submitBtnEl: HTMLButtonElement | null;

	constructor(
		app: App,
		modes: NoteMode[],
		file: TFile,
		onSubmit: (mode: NoteMode, extraContent: string) => void,
	) {
		super(app);
		this.modes = modes;
		this.file = file;
		this.onSubmit = onSubmit;
		this.selectedMode = null;
		this.extraValue = "";
		this.btnEls = [];
		this.submitBtnEl = null;
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal", "ch-modal-wide");
		setModalTitle(this, "Analyze note");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: `Analyzing: ${this.file.basename}` });

		wrapper.createDiv({ cls: "ch-label", text: "Analysis mode" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.pickMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });
		sep.createDiv({ cls: "ch-label", text: "Additional content (articles, context, instructions)" });
		const extraInput = sep.createEl("textarea", { cls: "ch-textarea ch-textarea-xl" });
		extraInput.placeholder = "Paste articles, blog posts, or extra context here...\n\nOptional for most modes: leave empty to analyze the note as it is.";
		extraInput.rows = 8;
		extraInput.addEventListener("input", () => { this.extraValue = extraInput.value; });
		extraInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		this.submitBtnEl = btnRow.createEl("button", { text: "Select an analysis mode" });
		this.submitBtnEl.disabled = true;
		this.submitBtnEl.addClass("mod-cta");
		this.submitBtnEl.addEventListener("click", () => this.doSubmit());
	}

	pickMode(mode: NoteMode): void {
		this.selectedMode = mode;
		for (const b of this.btnEls) {
			b.el.toggleClass("is-selected", b.id === mode.id);
		}
		if (this.submitBtnEl) {
			this.submitBtnEl.disabled = false;
			this.submitBtnEl.setText(`Analyze - ${mode.name}`);
		}
	}

	doSubmit(): void {
		if (!this.selectedMode) {
			new Notice("Pick an analysis mode.");
			return;
		}
		this.close();
		this.onSubmit(this.selectedMode, this.extraValue.trim());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
