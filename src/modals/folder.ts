import { App, Modal, Notice } from "obsidian";
import { NoteMode } from "../types";
import { createModeGrid, setModalTitle } from "../ui";

// ─── Topic Generator Modal ──────────────────────────────────────

export class TopicGeneratorModal extends Modal {
	modes: NoteMode[];
	folderPath: string;
	onSubmit: (topic: string, mode: NoteMode, isMulti: boolean, extraInstructions: string) => void;
	selectedMode: NoteMode | null;
	topicValue: string;
	extraValue: string;
	isMulti: boolean;
	btnEls: { id: string; el: HTMLElement }[];
	submitBtnEl: HTMLButtonElement | null;
	singleBtn: HTMLButtonElement | null;
	multiBtn: HTMLButtonElement | null;

	constructor(app: App, modes: NoteMode[], folderPath: string, onSubmit: (topic: string, mode: NoteMode, isMulti: boolean, extraInstructions: string) => void) {
		super(app);
		this.modes = modes;
		this.folderPath = folderPath;
		this.onSubmit = onSubmit;
		this.selectedMode = null;
		this.topicValue = "";
		this.extraValue = "";
		this.isMulti = false;
		this.btnEls = [];
		this.submitBtnEl = null;
		this.singleBtn = null;
		this.multiBtn = null;
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		setModalTitle(this, "Generate notes from topic");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: "Location: " + (this.folderPath || "/") });

		wrapper.createDiv({ cls: "ch-label", text: "Topic" });
		const topicInput = wrapper.createEl("input", { type: "text", cls: "ch-input" });
		topicInput.placeholder = "e.g. Photosynthesis, the Silk Road, compound interest...";
		topicInput.addEventListener("input", () => { this.topicValue = topicInput.value; this.updateSubmitButton(); });
		topicInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter") { e.preventDefault(); this.doSubmit(); }
		});

		wrapper.createDiv({ cls: "ch-label", text: "Note style" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.pickMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });

		sep.createDiv({ cls: "ch-label", text: "Output format" });
		const formatRow = sep.createDiv({ cls: "ch-format-row" });

		this.singleBtn = formatRow.createEl("button", { text: "Single note" });
		this.multiBtn = formatRow.createEl("button", { text: "Multi-note folder" });

		this.singleBtn.addEventListener("click", () => { this.isMulti = false; this.updateFormatButtons(); });
		this.multiBtn.addEventListener("click", () => { this.isMulti = true; this.updateFormatButtons(); });
		this.updateFormatButtons();

		sep.createDiv({ cls: "ch-hint", text: "Multi-note: the AI decomposes the topic into linked sub-notes in a folder" });

		wrapper.createDiv({ cls: "ch-label", text: "Extra instructions (optional)" });
		const extraInput = wrapper.createEl("textarea", { cls: "ch-textarea" });
		extraInput.placeholder = "e.g. Focus on practical examples, keep it beginner friendly...";
		extraInput.rows = 2;
		extraInput.addEventListener("input", () => { this.extraValue = extraInput.value; });
		extraInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		this.submitBtnEl = btnRow.createEl("button", { text: "Enter a topic and select a style" });
		this.submitBtnEl.disabled = true;
		this.submitBtnEl.addClass("mod-cta");
		this.submitBtnEl.addEventListener("click", () => this.doSubmit());
	}

	updateFormatButtons(): void {
		if (!this.singleBtn || !this.multiBtn) return;
		if (this.isMulti) {
			this.multiBtn.addClass("mod-cta");
			this.singleBtn.removeClass("mod-cta");
		} else {
			this.singleBtn.addClass("mod-cta");
			this.multiBtn.removeClass("mod-cta");
		}
	}

	pickMode(mode: NoteMode): void {
		this.selectedMode = mode;
		for (const b of this.btnEls) {
			b.el.toggleClass("is-selected", b.id === mode.id);
		}
		this.updateSubmitButton();
	}

	updateSubmitButton(): void {
		if (!this.submitBtnEl) return;
		if (this.topicValue.trim() && this.selectedMode) {
			this.submitBtnEl.disabled = false;
			const label = this.isMulti ? "Generate folder" : "Generate note";
			this.submitBtnEl.setText(`${label} - ${this.selectedMode.name}`);
		} else {
			this.submitBtnEl.disabled = true;
			this.submitBtnEl.setText("Enter a topic and select a style");
		}
	}

	doSubmit(): void {
		const topic = this.topicValue.trim();
		if (!topic) {
			new Notice("Enter a topic.");
			return;
		}
		if (!this.selectedMode) {
			new Notice("Pick a note style.");
			return;
		}
		this.close();
		this.onSubmit(topic, this.selectedMode, this.isMulti, this.extraValue.trim());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ─── Folder Generator Modal ─────────────────────────────────────

export class FolderGeneratorModal extends Modal {
	modes: NoteMode[];
	folderPath: string;
	folderName: string;
	onSubmit: (scenario: string, mode: NoteMode, extraInstructions: string) => void;
	selectedMode: NoteMode | null;
	scenarioValue: string;
	extraValue: string;
	btnEls: { id: string; el: HTMLElement }[];
	submitBtnEl: HTMLButtonElement | null;

	constructor(
		app: App,
		modes: NoteMode[],
		folderPath: string,
		folderName: string,
		onSubmit: (scenario: string, mode: NoteMode, extraInstructions: string) => void,
	) {
		super(app);
		this.modes = modes;
		this.folderPath = folderPath;
		this.folderName = folderName;
		this.onSubmit = onSubmit;
		this.selectedMode = null;
		this.scenarioValue = "";
		this.extraValue = "";
		this.btnEls = [];
		this.submitBtnEl = null;
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal", "ch-modal-wide");
		setModalTitle(this, "Generate knowledge notes");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: `Target folder: ${this.folderPath || "/"}` });

		wrapper.createDiv({ cls: "ch-label", text: "Scenario / Prompt" });
		const scenarioInput = wrapper.createEl("textarea", { cls: "ch-textarea ch-textarea-lg" });
		scenarioInput.placeholder = "e.g. Explain how vaccines work, from immune system basics to modern types...\n\nOr: A beginner's guide to reading company financial statements...\n\nOr: The causes and consequences of the French Revolution...";
		scenarioInput.rows = 5;
		scenarioInput.addEventListener("input", () => { this.scenarioValue = scenarioInput.value; this.updateSubmitButton(); });
		scenarioInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		wrapper.createDiv({ cls: "ch-label", text: "Note style" });
		wrapper.createDiv({ cls: "ch-hint", text: "Modes with a decomposition guide produce better multi-note breakdowns" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.pickMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });

		sep.createDiv({ cls: "ch-label", text: "Extra instructions (optional)" });
		const extraInput = sep.createEl("textarea", { cls: "ch-textarea" });
		extraInput.placeholder = "e.g. Aim for expert-level depth, include real-world case studies...";
		extraInput.rows = 2;
		extraInput.addEventListener("input", () => { this.extraValue = extraInput.value; });
		extraInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		this.submitBtnEl = btnRow.createEl("button", { text: "Enter a scenario and select a style" });
		this.submitBtnEl.disabled = true;
		this.submitBtnEl.addClass("mod-cta");
		this.submitBtnEl.addEventListener("click", () => this.doSubmit());
	}

	pickMode(mode: NoteMode): void {
		this.selectedMode = mode;
		for (const b of this.btnEls) {
			b.el.toggleClass("is-selected", b.id === mode.id);
		}
		this.updateSubmitButton();
	}

	updateSubmitButton(): void {
		if (!this.submitBtnEl) return;
		if (this.scenarioValue.trim() && this.selectedMode) {
			this.submitBtnEl.disabled = false;
			this.submitBtnEl.setText(`Generate notes - ${this.selectedMode.name}`);
		} else {
			this.submitBtnEl.disabled = true;
			this.submitBtnEl.setText("Enter a scenario and select a style");
		}
	}

	doSubmit(): void {
		const scenario = this.scenarioValue.trim();
		if (!scenario) {
			new Notice("Enter a scenario or prompt.");
			return;
		}
		if (!this.selectedMode) {
			new Notice("Pick a note style.");
			return;
		}
		this.close();
		this.onSubmit(scenario, this.selectedMode, this.extraValue.trim());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ─── Add Topic Modal ─────────────────────────────────────────────

export class AddTopicModal extends Modal {
	modes: NoteMode[];
	folderPath: string;
	folderName: string;
	onSubmit: (topic: string, mode: NoteMode, extraInstructions: string) => void;
	selectedMode: NoteMode | null;
	topicValue: string;
	extraValue: string;
	btnEls: { id: string; el: HTMLElement }[];
	submitBtnEl: HTMLButtonElement | null;

	constructor(
		app: App,
		modes: NoteMode[],
		folderPath: string,
		folderName: string,
		onSubmit: (topic: string, mode: NoteMode, extraInstructions: string) => void,
	) {
		super(app);
		this.modes = modes;
		this.folderPath = folderPath;
		this.folderName = folderName;
		this.onSubmit = onSubmit;
		this.selectedMode = null;
		this.topicValue = "";
		this.extraValue = "";
		this.btnEls = [];
		this.submitBtnEl = null;
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal", "ch-modal-wide");
		setModalTitle(this, "Add topic to folder");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: `Folder: ${this.folderPath || "/"}` });
		wrapper.createDiv({ cls: "ch-hint", text: "Existing notes in this folder will be used as context for the new note." });

		wrapper.createDiv({ cls: "ch-label", text: "Topic to add" });
		const topicInput = wrapper.createEl("textarea", { cls: "ch-textarea" });
		topicInput.placeholder = "e.g. The placebo effect\n\nThe missing topic that should be added to this folder. A single note will be generated using existing notes as context.";
		topicInput.rows = 3;
		topicInput.addEventListener("input", () => { this.topicValue = topicInput.value; this.updateSubmitButton(); });
		topicInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		wrapper.createDiv({ cls: "ch-label", text: "Note style" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.pickMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });
		sep.createDiv({ cls: "ch-label", text: "Extra instructions (optional)" });
		const extraInput = sep.createEl("textarea", { cls: "ch-textarea" });
		extraInput.placeholder = "e.g. Focus on the practical implications, include memorable examples...";
		extraInput.rows = 2;
		extraInput.addEventListener("input", () => { this.extraValue = extraInput.value; });
		extraInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		this.submitBtnEl = btnRow.createEl("button", { text: "Enter a topic and select a style" });
		this.submitBtnEl.disabled = true;
		this.submitBtnEl.addClass("mod-cta");
		this.submitBtnEl.addEventListener("click", () => this.doSubmit());
	}

	pickMode(mode: NoteMode): void {
		this.selectedMode = mode;
		for (const b of this.btnEls) {
			b.el.toggleClass("is-selected", b.id === mode.id);
		}
		this.updateSubmitButton();
	}

	updateSubmitButton(): void {
		if (!this.submitBtnEl) return;
		if (this.topicValue.trim() && this.selectedMode) {
			this.submitBtnEl.disabled = false;
			this.submitBtnEl.setText(`Add note - ${this.selectedMode.name}`);
		} else {
			this.submitBtnEl.disabled = true;
			this.submitBtnEl.setText("Enter a topic and select a style");
		}
	}

	doSubmit(): void {
		const topic = this.topicValue.trim();
		if (!topic) {
			new Notice("Enter a topic.");
			return;
		}
		if (!this.selectedMode) {
			new Notice("Pick a note style.");
			return;
		}
		this.close();
		this.onSubmit(topic, this.selectedMode, this.extraValue.trim());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ─── Expand Folder Modal ────────────────────────────────────────

export class ExpandFolderModal extends Modal {
	modes: NoteMode[];
	folderPath: string;
	folderName: string;
	existingNotes: string[];
	onSubmit: (direction: string, mode: NoteMode, extraInstructions: string) => void;
	selectedMode: NoteMode | null;
	directionValue: string;
	extraValue: string;
	btnEls: { id: string; el: HTMLElement }[];
	submitBtnEl: HTMLButtonElement | null;

	constructor(
		app: App,
		modes: NoteMode[],
		folderPath: string,
		folderName: string,
		existingNotes: string[],
		onSubmit: (direction: string, mode: NoteMode, extraInstructions: string) => void,
	) {
		super(app);
		this.modes = modes;
		this.folderPath = folderPath;
		this.folderName = folderName;
		this.existingNotes = existingNotes;
		this.onSubmit = onSubmit;
		this.selectedMode = null;
		this.directionValue = "";
		this.extraValue = "";
		this.btnEls = [];
		this.submitBtnEl = null;
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal", "ch-modal-wide");
		setModalTitle(this, "Expand folder with more notes");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: `Folder: ${this.folderPath || "/"}` });
		wrapper.createDiv({ cls: "ch-hint", text: `${this.existingNotes.length} existing notes will be read as context. New notes will not repeat existing content.` });

		if (this.existingNotes.length > 0) {
			const existingEl = wrapper.createDiv({ cls: "ch-existing-list" });
			existingEl.createEl("strong", { text: "Existing: " });
			existingEl.createSpan({ text: this.existingNotes.join(", ") });
		}

		wrapper.createDiv({ cls: "ch-label", text: "What to add" });
		const dirInput = wrapper.createEl("textarea", { cls: "ch-textarea ch-textarea-md" });
		dirInput.placeholder = "e.g. Add notes covering common misconceptions and frequently asked questions\n\nOr: Expand with real-world case studies and historical context\n\nOr: Add notes on the practical applications I haven't covered yet";
		dirInput.rows = 4;
		dirInput.addEventListener("input", () => { this.directionValue = dirInput.value; this.updateSubmitButton(); });
		dirInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		wrapper.createDiv({ cls: "ch-label", text: "Note style" });
		wrapper.createDiv({ cls: "ch-hint", text: "Can be different from the style used for existing notes" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.pickMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });
		sep.createDiv({ cls: "ch-label", text: "Extra instructions (optional)" });
		const extraInput = sep.createEl("textarea", { cls: "ch-textarea" });
		extraInput.placeholder = "e.g. Aim for expert-level depth, include concrete examples...";
		extraInput.rows = 2;
		extraInput.addEventListener("input", () => { this.extraValue = extraInput.value; });
		extraInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		this.submitBtnEl = btnRow.createEl("button", { text: "Describe what to add and select a style" });
		this.submitBtnEl.disabled = true;
		this.submitBtnEl.addClass("mod-cta");
		this.submitBtnEl.addEventListener("click", () => this.doSubmit());
	}

	pickMode(mode: NoteMode): void {
		this.selectedMode = mode;
		for (const b of this.btnEls) {
			b.el.toggleClass("is-selected", b.id === mode.id);
		}
		this.updateSubmitButton();
	}

	updateSubmitButton(): void {
		if (!this.submitBtnEl) return;
		if (this.directionValue.trim() && this.selectedMode) {
			this.submitBtnEl.disabled = false;
			this.submitBtnEl.setText(`Expand folder - ${this.selectedMode.name}`);
		} else {
			this.submitBtnEl.disabled = true;
			this.submitBtnEl.setText("Describe what to add and select a style");
		}
	}

	doSubmit(): void {
		const direction = this.directionValue.trim();
		if (!direction) {
			new Notice("Describe what notes to add.");
			return;
		}
		if (!this.selectedMode) {
			new Notice("Pick a note style.");
			return;
		}
		this.close();
		this.onSubmit(direction, this.selectedMode, this.extraValue.trim());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
