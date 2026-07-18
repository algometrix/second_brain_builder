import { App, Modal, Notice } from "obsidian";
import { InlineAction, InlineActionConfig, NoteConfig, NoteMode } from "../types";
import { createModeGrid, renderModeCard, setModalTitle } from "../ui";
import { sanitizeFilename, splitIntoTopics } from "../utils";

// ─── Note Creator Modal (multi-select) ───────────────────────────

export class NoteCreatorModal extends Modal {
	modes: NoteMode[];
	selection: string;
	lastModeId: string;
	onSubmit: (configs: NoteConfig[]) => void;
	onModeUsed: (modeId: string) => void;
	selectedModes: NoteMode[];
	titleValue: string;
	extraValue: string;
	subfolderDefault: string | null;
	subfolderValue: string;
	topicsValue: string;
	parentFolderPath: string;
	previewEl: HTMLDivElement | null;
	btnEls: { id: string; el: HTMLElement }[];
	submitBtnEl: HTMLButtonElement | null;

	constructor(app: App, modes: NoteMode[], selection: string, lastModeId: string, onSubmit: (configs: NoteConfig[]) => void, onModeUsed?: (modeId: string) => void, subfolderDefault?: string, parentFolderPath?: string) {
		super(app);
		this.modes = modes;
		this.selection = String(selection || "");
		this.lastModeId = lastModeId;
		this.onSubmit = onSubmit;
		this.onModeUsed = onModeUsed || (() => {});
		this.selectedModes = [];
		this.titleValue = sanitizeFilename(this.selection);
		this.extraValue = "";
		this.subfolderDefault = subfolderDefault ?? null;
		this.subfolderValue = subfolderDefault ?? "";
		this.topicsValue = splitIntoTopics(this.selection).join("\n");
		this.parentFolderPath = parentFolderPath ?? "";
		this.previewEl = null;
		this.btnEls = [];
		this.submitBtnEl = null;
	}

	parseTopics(): string[] {
		return [...new Set(this.topicsValue.split("\n").map(t => sanitizeFilename(t)).filter(Boolean))];
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		setModalTitle(this, this.subfolderDefault === null ? "Create note" : "Create sub-notes");

		const wrapper = el.createDiv();

		if (this.subfolderDefault !== null) {
			const intro = wrapper.createDiv({ cls: "ch-flow" });
			const sel = this.selection.length > 80 ? this.selection.slice(0, 80) + "..." : this.selection;
			intro.createDiv({ cls: "ch-flow-selection", text: `Selected: "${sel}"` });
			intro.createDiv({ text: "Each title below becomes its own note, generated using your selection and this note as context. Rename the titles to anything - the notes stay grounded in the selected text, and they link to each other and back to this note." });
		}

		wrapper.createDiv({ cls: "ch-label", text: "Note style" });
		wrapper.createDiv({ cls: "ch-hint", text: "Click multiple to blend styles into one note" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.toggleMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });

		if (this.subfolderDefault === null) {
			sep.createDiv({ cls: "ch-label", text: "Note title" });
			const titleInput = sep.createEl("input", { type: "text", cls: "ch-input" });
			titleInput.value = this.titleValue;
			titleInput.addEventListener("input", () => { this.titleValue = titleInput.value; });
			titleInput.addEventListener("keydown", (e) => {
				e.stopPropagation();
				if (e.key === "Enter") { e.preventDefault(); this.doSubmit(); }
			});
		} else {
			sep.createDiv({ cls: "ch-label", text: "Sub-folder (created under this note's folder)" });
			const subfolderInput = sep.createEl("input", { type: "text", cls: "ch-input" });
			subfolderInput.value = this.subfolderValue;
			subfolderInput.placeholder = "e.g. Components, Deep Dives...";
			subfolderInput.addEventListener("input", () => {
				this.subfolderValue = subfolderInput.value;
				this.updatePreview();
			});
			subfolderInput.addEventListener("keydown", (e) => {
				e.stopPropagation();
				if (e.key === "Enter") { e.preventDefault(); this.doSubmit(); }
			});

			sep.createDiv({ cls: "ch-label", text: "Note titles (one per line)" });
			sep.createDiv({ cls: "ch-hint", text: "Each line is the exact title of one new note" });
			const topicsInput = sep.createEl("textarea", { cls: "ch-textarea" });
			topicsInput.value = this.topicsValue;
			topicsInput.rows = Math.min(8, Math.max(3, this.topicsValue.split("\n").length));
			topicsInput.addEventListener("input", () => {
				this.topicsValue = topicsInput.value;
				this.updatePreview();
				this.updateModeButtons();
			});
			topicsInput.addEventListener("keydown", (e) => {
				e.stopPropagation();
				if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
			});

			this.previewEl = sep.createDiv();
			this.updatePreview();
		}

		sep.createDiv({ cls: "ch-label", text: "Extra instructions (optional)" });
		const extraInput = sep.createEl("textarea", { cls: "ch-textarea" });
		extraInput.placeholder = "e.g. Focus on practical examples, compare with X, keep it beginner-level...";
		extraInput.rows = 2;
		extraInput.addEventListener("input", () => { this.extraValue = extraInput.value; });
		extraInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		this.submitBtnEl = btnRow.createEl("button", { text: "Select a note style" });
		this.submitBtnEl.disabled = true;
		this.submitBtnEl.addClass("mod-cta");
		this.submitBtnEl.addEventListener("click", () => this.doSubmit());

		if (this.lastModeId) {
			const lastMode = this.modes.find(m => m.id === this.lastModeId);
			if (lastMode) this.toggleMode(lastMode);
		}
	}

	toggleMode(mode: NoteMode): void {
		const idx = this.selectedModes.findIndex(m => m.id === mode.id);
		if (idx >= 0) {
			this.selectedModes.splice(idx, 1);
		} else {
			this.selectedModes.push(mode);
		}
		this.updateModeButtons();
		this.updatePreview();
	}

	updateModeButtons(): void {
		const selectedIds = new Set(this.selectedModes.map(m => m.id));
		for (const b of this.btnEls) {
			b.el.toggleClass("is-selected", selectedIds.has(b.id));
		}
		if (this.submitBtnEl) {
			const generateLabel = this.subfolderDefault === null
				? "Generate"
				: `Generate ${this.parseTopics().length || "?"} sub-note${this.parseTopics().length === 1 ? "" : "s"}`;
			if (this.selectedModes.length === 0) {
				this.submitBtnEl.disabled = true;
				this.submitBtnEl.setText("Select a note style");
			} else if (this.selectedModes.length === 1) {
				this.submitBtnEl.disabled = false;
				this.submitBtnEl.setText(`${generateLabel} - ${this.selectedModes[0].name}`);
			} else {
				this.submitBtnEl.disabled = false;
				this.submitBtnEl.setText(`${generateLabel} blended - ${this.selectedModes.map(m => m.name).join(" + ")}`);
			}
		}
	}

	updatePreview(): void {
		if (!this.previewEl) return;
		this.previewEl.empty();
		const subfolder = sanitizeFilename(this.subfolderValue);
		const dir = this.parentFolderPath
			? `${this.parentFolderPath}/${subfolder || "?"}`
			: (subfolder || "?");
		const titles = this.parseTopics();
		this.previewEl.createDiv({ cls: "ch-label", text: "What will happen" });
		if (titles.length === 0) {
			this.previewEl.createDiv({ cls: "ch-hint", text: "Nothing yet - add at least one title line above" });
			return;
		}
		const styleName = this.selectedModes.length > 0
			? this.selectedModes.map(m => m.name).join(" + ")
			: "the selected style";
		const list = this.previewEl.createDiv({ cls: "ch-preview-list" });
		for (const title of titles) {
			list.createDiv({ cls: "ch-preview-item", text: `${dir}/${title}.md - a ${styleName} note about "${title}"` });
		}
		list.createDiv({ cls: "ch-preview-note", text: "Each note is written from your selected passage and the surrounding note, and links to the other notes above and back to this note." });
	}

	doSubmit(): void {
		if (this.selectedModes.length === 0) {
			new Notice("Pick at least one note style.");
			return;
		}
		let titles: string[];
		let subfolder: string | undefined;
		if (this.subfolderDefault === null) {
			const title = sanitizeFilename(this.titleValue.trim());
			if (!title) {
				new Notice("Note title cannot be empty.");
				return;
			}
			titles = [title];
		} else {
			subfolder = sanitizeFilename(this.subfolderValue);
			if (!subfolder) {
				new Notice("Sub-folder name cannot be empty.");
				return;
			}
			titles = this.parseTopics();
			if (titles.length === 0) {
				new Notice("Add at least one sub-note title.");
				return;
			}
		}
		this.close();

		// Remember the last used mode (first selected)
		this.onModeUsed(this.selectedModes[0].id);

		let finalMode: NoteMode;
		if (this.selectedModes.length === 1) {
			finalMode = this.selectedModes[0];
		} else {
			finalMode = NoteCreatorModal.createBlendedMode(this.selectedModes);
		}

		this.onSubmit(titles.map(title => ({
			mode: finalMode,
			title,
			extraInstructions: this.extraValue.trim(),
			subfolder,
		})));
	}

	static createBlendedMode(modes: NoteMode[]): NoteMode {
		const styleList = modes.map((m, i) =>
			`${i + 1}. **${m.name}** -${m.description}`
		).join("\n");

		const prompt = `You are a knowledge assistant creating a note that seamlessly combines multiple note-taking styles into one cohesive document for an Obsidian vault.

The user selected "{selection}" while reading the following note:

---
{context}
---

Create a comprehensive note on "{selection}" that blends the following styles:

${styleList}

Guidelines for blending:
- Do NOT create separate sections for each style. Weave their strengths together naturally into a single cohesive note.
- Draw on the structural depth of more analytical styles and the clarity of more accessible styles.
- If one style emphasizes examples and another emphasizes theory, include both - interleaved, not segregated.
- If styles have overlapping sections (e.g. both want "Related Concepts"), merge them into one.
- Use the strongest elements from each style: analogies, diagrams, critical questions, worked examples, proofs, trade-off analysis, etc.
- Maintain a consistent tone throughout - do not shift voice between sections.
- Use mermaid diagrams, tables, code blocks, and LaTeX where appropriate.
- Link related concepts as \`[[WikiLinks]]\`.
- Use Obsidian callouts (\`> [!tip]\`, \`> [!warning]\`, \`> [!info]\`, \`> [!question]\`, etc.) where they add value.`;

		return {
			id: "blended-" + modes.map(m => m.id).join("-"),
			name: modes.map(m => m.name).join(" + "),
			icon: modes[0].icon,
			description: "Blended: " + modes.map(m => m.name).join(", "),
			prompt,
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ─── Inline Action Modal ─────────────────────────────────────────

export class InlineActionModal extends Modal {
	actions: InlineAction[];
	selection: string;
	onSubmit: (config: InlineActionConfig) => void;
	selectedAction: InlineAction | null;
	insertionMode: "replace" | "below";
	extraValue: string;
	btnEls: { id: string; el: HTMLElement }[];
	submitBtnEl: HTMLButtonElement | null;
	preselectedAction: InlineAction | null;
	replaceBtn: HTMLButtonElement | null;
	belowBtn: HTMLButtonElement | null;

	constructor(app: App, actions: InlineAction[], selection: string, onSubmit: (config: InlineActionConfig) => void, preselectedAction?: InlineAction) {
		super(app);
		this.actions = actions;
		this.selection = selection;
		this.onSubmit = onSubmit;
		this.selectedAction = preselectedAction || null;
		this.insertionMode = "below";
		this.extraValue = "";
		this.btnEls = [];
		this.submitBtnEl = null;
		this.preselectedAction = preselectedAction || null;
		this.replaceBtn = null;
		this.belowBtn = null;
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");

		const label = this.selection.length > 60 ? this.selection.slice(0, 60) + "..." : this.selection;
		setModalTitle(this, `Enhance: "${label}"`);

		const wrapper = el.createDiv();

		if (!this.preselectedAction) {
			wrapper.createDiv({ cls: "ch-label", text: "Action" });
			const grid = wrapper.createDiv({ cls: "ch-grid ch-grid-3col" });

			this.btnEls = [];
			for (const action of this.actions) {
				const card = renderModeCard(grid, action);
				this.btnEls.push({ id: action.id, el: card });
				card.addEventListener("click", () => this.pickAction(action));
			}
		}

		const sep = wrapper.createDiv({ cls: "ch-sep" });

		sep.createDiv({ cls: "ch-label", text: "Insertion mode" });
		const modeRow = sep.createDiv({ cls: "ch-format-row" });

		this.replaceBtn = modeRow.createEl("button", { text: "Replace selection" });
		this.belowBtn = modeRow.createEl("button", { text: "Insert below" });

		this.replaceBtn.addEventListener("click", () => { this.insertionMode = "replace"; this.updateModeButtons(); });
		this.belowBtn.addEventListener("click", () => { this.insertionMode = "below"; this.updateModeButtons(); });
		this.updateModeButtons();

		wrapper.createDiv({ cls: "ch-label", text: "Extra instructions (optional)" });
		const extraInput = wrapper.createEl("textarea", { cls: "ch-textarea" });
		extraInput.placeholder = "e.g. Keep it under 200 words, use simple analogies...";
		extraInput.rows = 2;
		extraInput.addEventListener("input", () => { this.extraValue = extraInput.value; });
		extraInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		this.submitBtnEl = btnRow.createEl("button");
		if (this.preselectedAction) {
			this.submitBtnEl.setText("Run - " + this.preselectedAction.name);
			this.submitBtnEl.disabled = false;
		} else {
			this.submitBtnEl.setText("Select an action");
			this.submitBtnEl.disabled = true;
		}
		this.submitBtnEl.addClass("mod-cta");
		this.submitBtnEl.addEventListener("click", () => this.doSubmit());
	}

	updateModeButtons(): void {
		if (!this.replaceBtn || !this.belowBtn) return;
		if (this.insertionMode === "replace") {
			this.replaceBtn.addClass("mod-cta");
			this.belowBtn.removeClass("mod-cta");
		} else {
			this.belowBtn.addClass("mod-cta");
			this.replaceBtn.removeClass("mod-cta");
		}
	}

	pickAction(action: InlineAction): void {
		this.selectedAction = action;
		for (const b of this.btnEls) {
			b.el.toggleClass("is-selected", b.id === action.id);
		}
		if (this.submitBtnEl) {
			this.submitBtnEl.disabled = false;
			this.submitBtnEl.setText("Run - " + action.name);
		}
	}

	doSubmit(): void {
		if (!this.selectedAction) {
			new Notice("Pick an action first.");
			return;
		}
		this.close();
		this.onSubmit({
			action: this.selectedAction,
			insertionMode: this.insertionMode,
			extraInstructions: this.extraValue.trim(),
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ─── Full Note Action Modal (for fullNote modes) ────────────────

export class FullNoteActionModal extends Modal {
	modes: NoteMode[];
	fileName: string;
	onSubmit: (mode: NoteMode, extraInstructions: string) => void;
	selectedMode: NoteMode | null;
	extraValue: string;
	btnEls: { id: string; el: HTMLElement }[];
	submitBtnEl: HTMLButtonElement | null;

	constructor(app: App, modes: NoteMode[], fileName: string, onSubmit: (mode: NoteMode, extraInstructions: string) => void) {
		super(app);
		this.modes = modes;
		this.fileName = fileName;
		this.onSubmit = onSubmit;
		this.selectedMode = null;
		this.extraValue = "";
		this.btnEls = [];
		this.submitBtnEl = null;
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		setModalTitle(this, "Analyze: " + this.fileName);

		const wrapper = el.createDiv();

		wrapper.createDiv({ cls: "ch-label", text: "Action" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.pickMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });

		sep.createDiv({ cls: "ch-label", text: "Extra instructions (optional)" });
		const extraInput = sep.createEl("textarea", { cls: "ch-textarea" });
		extraInput.placeholder = "e.g. Focus on open-ended questions, make exercises harder...";
		extraInput.rows = 2;
		extraInput.addEventListener("input", () => { this.extraValue = extraInput.value; });
		extraInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		this.submitBtnEl = btnRow.createEl("button", { text: "Select an action" });
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
			this.submitBtnEl.setText("Analyze - " + mode.name);
		}
	}

	doSubmit(): void {
		if (!this.selectedMode) {
			new Notice("Pick an action first.");
			return;
		}
		this.close();
		this.onSubmit(this.selectedMode, this.extraValue.trim());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ─── Fill Note Modal ────────────────────────────────────────────

export class FillNoteModal extends Modal {
	modes: NoteMode[];
	fileName: string;
	backlinkContext: string;
	backlinkSources: string[];
	lastModeId: string;
	onSubmit: (mode: NoteMode, context: string, extraInstructions: string) => void;
	onModeUsed: (modeId: string) => void;
	selectedMode: NoteMode | null;
	contextValue: string;
	extraValue: string;
	btnEls: { id: string; el: HTMLElement }[];
	submitBtnEl: HTMLButtonElement | null;

	constructor(
		app: App,
		modes: NoteMode[],
		fileName: string,
		backlinkContext: string,
		backlinkSources: string[],
		lastModeId: string,
		onSubmit: (mode: NoteMode, context: string, extraInstructions: string) => void,
		onModeUsed?: (modeId: string) => void,
	) {
		super(app);
		this.modes = modes;
		this.fileName = fileName;
		this.backlinkContext = backlinkContext;
		this.backlinkSources = backlinkSources;
		this.lastModeId = lastModeId;
		this.onSubmit = onSubmit;
		this.onModeUsed = onModeUsed || (() => {});
		this.selectedMode = null;
		this.contextValue = backlinkContext;
		this.extraValue = "";
		this.btnEls = [];
		this.submitBtnEl = null;
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		setModalTitle(this, "Fill: " + this.fileName);

		const wrapper = el.createDiv();

		if (this.backlinkSources.length > 0) {
			const blInfo = wrapper.createDiv({ cls: "ch-backlink-info" });
			blInfo.createDiv({ cls: "ch-label", text: `Context from ${this.backlinkSources.length} backlink${this.backlinkSources.length > 1 ? "s" : ""}:` });
			for (const src of this.backlinkSources) {
				blInfo.createDiv({ cls: "ch-hint", text: "  " + src });
			}
		} else {
			wrapper.createDiv({ cls: "ch-hint", text: "No backlinks found. Provide context below or leave empty for a general note." });
		}

		wrapper.createDiv({ cls: "ch-label", text: this.backlinkSources.length > 0 ? "Context (from backlinks, editable)" : "Context (describe what this note should cover)" });
		const ctxInput = wrapper.createEl("textarea", { cls: "ch-textarea ch-textarea-sm" });
		ctxInput.value = this.contextValue;
		ctxInput.placeholder = "e.g. This note should explain how compound interest works, with step-by-step examples...";
		ctxInput.rows = 4;
		ctxInput.addEventListener("input", () => { this.contextValue = ctxInput.value; });

		wrapper.createDiv({ cls: "ch-label", text: "Note style" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.pickMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });

		sep.createDiv({ cls: "ch-label", text: "Extra instructions (optional)" });
		const extraInput = sep.createEl("textarea", { cls: "ch-textarea" });
		extraInput.placeholder = "e.g. Keep it beginner-level, include diagrams...";
		extraInput.rows = 2;
		extraInput.addEventListener("input", () => { this.extraValue = extraInput.value; });
		extraInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.doSubmit(); }
		});

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		this.submitBtnEl = btnRow.createEl("button", { text: "Select a note style" });
		this.submitBtnEl.disabled = true;
		this.submitBtnEl.addClass("mod-cta");
		this.submitBtnEl.addEventListener("click", () => this.doSubmit());

		if (this.lastModeId) {
			const lastMode = this.modes.find(m => m.id === this.lastModeId);
			if (lastMode) this.pickMode(lastMode);
		}
	}

	pickMode(mode: NoteMode): void {
		this.selectedMode = mode;
		for (const b of this.btnEls) {
			b.el.toggleClass("is-selected", b.id === mode.id);
		}
		if (this.submitBtnEl) {
			this.submitBtnEl.disabled = false;
			this.submitBtnEl.setText("Generate - " + mode.name);
		}
	}

	doSubmit(): void {
		if (!this.selectedMode) {
			new Notice("Pick a note style.");
			return;
		}
		this.close();
		this.onModeUsed(this.selectedMode.id);
		this.onSubmit(this.selectedMode, this.contextValue.trim(), this.extraValue.trim());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
