import { Modal, setIcon } from "obsidian";
import { NoteMode } from "./types";

export function setModalTitle(modal: Modal, title: string): void {
	if (typeof modal.setTitle === "function") {
		modal.setTitle(title);
	}
	if (modal.titleEl) {
		modal.titleEl.innerText = title;
	}
}

export function renderModeCard(container: HTMLElement, mode: NoteMode): HTMLElement {
	const card = container.createDiv({ cls: "ch-card" });
	const iconEl = card.createDiv({ cls: "ch-card-icon" });
	setIcon(iconEl, mode.icon);
	const body = card.createDiv({ cls: "ch-card-body" });
	body.createDiv({ cls: "ch-card-name", text: mode.name });
	body.createDiv({ cls: "ch-card-desc", text: mode.description });
	return card;
}

export function createModeGrid(
	wrapper: HTMLElement,
	modes: NoteMode[],
	onCardClick: (mode: NoteMode, card: HTMLElement) => void,
): { grid: HTMLElement; cards: { id: string; el: HTMLElement }[] } {
	const search = wrapper.createEl("input", { type: "text", cls: "ch-search", placeholder: "Search styles..." });
	const grid = wrapper.createDiv({ cls: "ch-grid" });
	const cards: { id: string; el: HTMLElement }[] = [];

	for (const mode of modes) {
		const card = renderModeCard(grid, mode);
		cards.push({ id: mode.id, el: card });
		card.addEventListener("click", () => onCardClick(mode, card));
	}

	search.addEventListener("keydown", (e) => {
		e.stopPropagation();
		if (e.key === "Enter") {
			e.preventDefault();
			const firstVisible = cards.find(c => !c.el.hasClass("ch-hidden"));
			firstVisible?.el.click();
		}
	});
	search.addEventListener("input", () => {
		const q = search.value.toLowerCase();
		for (const c of cards) {
			const mode = modes.find(m => m.id === c.id)!;
			const match = !q || mode.name.toLowerCase().includes(q) || mode.description.toLowerCase().includes(q);
			c.el.toggleClass("ch-hidden", !match);
		}
	});

	return { grid, cards };
}
