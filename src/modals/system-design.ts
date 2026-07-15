import { App, Modal, Notice } from "obsidian";
import { setModalTitle } from "../ui";

// ─── Scale Calculator Modal ─────────────────────────────────────

export class ScaleCalculatorModal extends Modal {
	onInsert: (markdown: string) => void;

	constructor(app: App, onInsert: (markdown: string) => void) {
		super(app);
		this.onInsert = onInsert;
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		setModalTitle(this, "Scale estimation calculator");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: "Enter values to generate a scale estimation table for your system design note." });

		const fields: { label: string; key: string; placeholder: string; default: string }[] = [
			{ label: "Daily Active Users (DAU)", key: "dau", placeholder: "e.g. 50000000", default: "" },
			{ label: "Requests per user per day", key: "rpud", placeholder: "e.g. 20", default: "10" },
			{ label: "Average read payload (KB)", key: "readKb", placeholder: "e.g. 5", default: "2" },
			{ label: "Average write payload (KB)", key: "writeKb", placeholder: "e.g. 50", default: "10" },
			{ label: "Read:Write ratio", key: "rwRatio", placeholder: "e.g. 10:1", default: "10:1" },
			{ label: "Data retention (years)", key: "retention", placeholder: "e.g. 5", default: "5" },
		];

		const inputs: Record<string, HTMLInputElement> = {};

		for (const f of fields) {
			wrapper.createDiv({ cls: "ch-label", text: f.label });
			const input = wrapper.createEl("input", { type: "text", cls: "ch-input" });
			input.placeholder = f.placeholder;
			input.value = f.default;
			inputs[f.key] = input;
		}

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		const btn = btnRow.createEl("button", { text: "Generate & insert" });
		btn.addClass("mod-cta");
		btn.addEventListener("click", () => {
			const dau = parseFloat(inputs.dau.value) || 0;
			const rpud = parseFloat(inputs.rpud.value) || 10;
			const readKb = parseFloat(inputs.readKb.value) || 2;
			const writeKb = parseFloat(inputs.writeKb.value) || 10;
			const retention = parseFloat(inputs.retention.value) || 5;

			const rwParts = (inputs.rwRatio.value || "10:1").split(":");
			const readRatio = parseFloat(rwParts[0]) || 10;
			const writeRatio = parseFloat(rwParts[1]) || 1;
			const totalRatio = readRatio + writeRatio;

			if (dau <= 0) {
				new Notice("Enter a valid DAU value.");
				return;
			}

			const totalReqDay = dau * rpud;
			const avgQps = totalReqDay / 86400;
			const peakQps = avgQps * 3;
			const readQps = avgQps * (readRatio / totalRatio);
			const writeQps = avgQps * (writeRatio / totalRatio);

			const readBwMbps = (readQps * readKb) / 1024;
			const writeBwMbps = (writeQps * writeKb) / 1024;

			const storagePerDayGb = (writeQps * writeKb * 86400) / (1024 * 1024);
			const storagePerYearTb = (storagePerDayGb * 365) / 1024;
			const storageTotalTb = storagePerYearTb * retention;

			const fmt = (n: number, d = 0): string => {
				if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
				if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
				if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
				return n.toFixed(d);
			};

			const md = `## Scale Estimation

| Metric | Value |
|---|---|
| DAU | ${fmt(dau)} |
| Requests/day | ${fmt(totalReqDay)} |
| Average QPS | ${fmt(avgQps, 0)} |
| Peak QPS (3x) | ${fmt(peakQps, 0)} |
| Read QPS | ${fmt(readQps, 0)} |
| Write QPS | ${fmt(writeQps, 0)} |
| Read bandwidth | ${readBwMbps.toFixed(1)} MB/s |
| Write bandwidth | ${writeBwMbps.toFixed(1)} MB/s |
| Storage/day | ${storagePerDayGb.toFixed(1)} GB |
| Storage/year | ${storagePerYearTb.toFixed(2)} TB |
| Storage (${retention}yr) | ${storageTotalTb.toFixed(2)} TB |

**Assumptions:** ${fmt(dau)} DAU, ${rpud} req/user/day, ${readKb}KB reads, ${writeKb}KB writes, ${readRatio}:${writeRatio} read:write ratio, ${retention}yr retention. Peak = 3x average.
`;

			this.close();
			this.onInsert(md);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ─── Scaffold Workspace Modal ───────────────────────────────────

export class ScaffoldWorkspaceModal extends Modal {
	onSubmit: (name: string, sections: string[]) => void | Promise<void>;
	selectedSections: Set<string>;

	constructor(app: App, onSubmit: (name: string, sections: string[]) => void | Promise<void>) {
		super(app);
		this.onSubmit = onSubmit;
		this.selectedSections = new Set(["Systems", "Patterns", "Components", "Failures", "Tradeoffs", "Simulations", "Glossary"]);
	}

	onOpen(): void {
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		setModalTitle(this, "Scaffold system design workspace");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: "Creates a folder hierarchy for organizing system design notes with an index note." });

		wrapper.createDiv({ cls: "ch-label", text: "Workspace name" });
		const nameInput = wrapper.createEl("input", { type: "text", cls: "ch-input" });
		nameInput.value = "System Design";
		nameInput.placeholder = "e.g. System Design, Interview Prep, Architecture";

		wrapper.createDiv({ cls: "ch-label", text: "Sections to create" });

		const sections = [
			{ id: "Systems", desc: "Full system design notes (YouTube, WhatsApp, Uber)" },
			{ id: "Patterns", desc: "Design patterns (Saga, CQRS, Event Sourcing)" },
			{ id: "Components", desc: "Technology deep-dives (Redis, Kafka, Postgres)" },
			{ id: "Failures", desc: "Failure modes (Cache Stampede, Split Brain)" },
			{ id: "Tradeoffs", desc: "Technology comparisons (Postgres vs Cassandra)" },
			{ id: "Simulations", desc: "Request flows and path traces" },
			{ id: "Glossary", desc: "Term definitions and concept maps" },
		];

		const checkboxes: { id: string; cb: HTMLInputElement }[] = [];

		const grid = wrapper.createDiv({ cls: "ch-grid" });
		for (const sec of sections) {
			const card = grid.createDiv({ cls: "ch-card is-selected" });

			const cb = card.createEl("input", { type: "checkbox", cls: "ch-card-checkbox" });
			cb.checked = true;

			const body = card.createDiv({ cls: "ch-card-body" });
			body.createDiv({ cls: "ch-card-name", text: sec.id });
			body.createDiv({ cls: "ch-card-desc", text: sec.desc });

			checkboxes.push({ id: sec.id, cb });

			const toggle = () => {
				cb.checked = !cb.checked;
				if (cb.checked) {
					this.selectedSections.add(sec.id);
					card.addClass("is-selected");
				} else {
					this.selectedSections.delete(sec.id);
					card.removeClass("is-selected");
				}
			};

			card.addEventListener("click", (e) => {
				if (e.target !== cb) toggle();
			});
			cb.addEventListener("change", () => {
				if (cb.checked) {
					this.selectedSections.add(sec.id);
					card.addClass("is-selected");
				} else {
					this.selectedSections.delete(sec.id);
					card.removeClass("is-selected");
				}
			});
		}

		const btnRow = wrapper.createDiv({ cls: "ch-btn-row" });
		const btn = btnRow.createEl("button", { text: "Create workspace" });
		btn.addClass("mod-cta");
		btn.addEventListener("click", () => {
			const name = nameInput.value.trim();
			if (!name) {
				new Notice("Enter a workspace name.");
				return;
			}
			if (this.selectedSections.size === 0) {
				new Notice("Select at least one section.");
				return;
			}
			this.close();
			void this.onSubmit(name, Array.from(this.selectedSections));
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
