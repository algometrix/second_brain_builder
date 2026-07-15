import { App, Modal, Notice } from "obsidian";
import { PROVIDER_LABELS, QueueItem } from "../types";
import { logger } from "../logger";
import { setModalTitle } from "../ui";
import type ClaudeExplainerPlugin from "../main";

// ─── Queue Status Modal ──────────────────────────────────────────

export class QueueStatusModal extends Modal {
	plugin: ClaudeExplainerPlugin;
	private intervalId: number | null = null;
	private previewEl: HTMLElement | null = null;
	private timerEl: HTMLElement | null = null;
	private queueListEl: HTMLElement | null = null;
	private failedListEl: HTMLElement | null = null;
	private completedListEl: HTMLElement | null = null;
	private headerEl: HTMLElement | null = null;

	constructor(app: App, plugin: ClaudeExplainerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.buildLayout();
		this.intervalId = window.setInterval(() => this.refresh(), 500);
	}

	buildLayout(): void {
		const el = this.contentEl;
		el.empty();
		setModalTitle(this, "Generation queue");

		const wrapper = el.createDiv({ cls: "ch-queue-wrapper" });

		this.headerEl = wrapper.createDiv({ cls: "ch-queue-header" });

		this.timerEl = wrapper.createDiv({ cls: "ch-queue-timer" });

		wrapper.createDiv({ cls: "ch-section-label", text: "Live output" });

		this.previewEl = wrapper.createEl("pre", { cls: "ch-queue-preview" });

		this.queueListEl = wrapper.createDiv({ cls: "ch-queue-list" });

		this.failedListEl = wrapper.createDiv({ cls: "ch-queue-list" });

		this.completedListEl = wrapper.createDiv({ cls: "ch-queue-list" });

		const btnContainer = wrapper.createDiv({ cls: "ch-queue-actions" });

		const clearBtn = btnContainer.createEl("button", { text: "Clear pending queue" });
		clearBtn.addEventListener("click", () => {
			this.plugin.clearQueue();
			this.refresh();
		});

		const retryAllBtn = btnContainer.createEl("button", { text: "Retry all failed" });
		retryAllBtn.addEventListener("click", () => {
			this.plugin.retryFailed();
			this.refresh();
		});

		this.refresh();
	}

	private getItemLabelLocal(item: QueueItem): string {
		if (item.type === "note") return item.noteName;
		if (item.type === "append") return item.fileName;
		if (item.type === "topic-note") return item.noteName;
		return `[${item.action.name}] inline`;
	}

	private getItemModeName(item: QueueItem): string {
		if (item.type === "note") return item.mode.name;
		if (item.type === "append") return item.mode.name;
		if (item.type === "topic-note") return item.mode.name;
		return item.action.name;
	}

	refresh(): void {
		const processing = this.plugin.getProcessingItem();
		const streamData = this.plugin.getStreamData();
		const queue = this.plugin.getQueue();

		if (this.headerEl) {
			if (processing) {
				this.headerEl.setText("");
				this.headerEl.createEl("h3", {
					cls: "ch-queue-title",
					text: "Generating: " + this.getItemLabelLocal(processing),
				});
				this.headerEl.createSpan({ cls: "ch-badge", text: this.getItemModeName(processing) });
			} else {
				this.headerEl.setText("");
				this.headerEl.createEl("h3", { cls: "ch-queue-title", text: "Queue idle" });
			}
		}

		if (this.timerEl) {
			if (processing && streamData.startTime > 0) {
				const elapsed = Math.floor((Date.now() - streamData.startTime) / 1000);
				const mins = Math.floor(elapsed / 60);
				const secs = elapsed % 60;
				const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
				const chars = streamData.currentOutput.length;
				this.timerEl.setText(`Elapsed: ${timeStr} | ${chars} chars received`);
			} else {
				this.timerEl.setText("");
			}
		}

		if (this.previewEl) {
			if (processing) {
				const output = streamData.currentOutput;
				if (output.length > 0) {
					const tail = output.length > 2000 ? "...\n" + output.slice(-2000) : output;
					this.previewEl.setText(tail);
				} else {
					this.previewEl.setText(`Waiting for ${PROVIDER_LABELS[this.plugin.settings.aiProvider]} to respond...`);
				}
				this.previewEl.scrollTop = this.previewEl.scrollHeight;
			} else {
				this.previewEl.setText("No active generation.");
			}
		}

		if (this.queueListEl) {
			this.queueListEl.setText("");
			if (queue.length > 0) {
				this.queueListEl.createDiv({ cls: "ch-section-label", text: "Up next (" + queue.length + ")" });

				for (let i = 0; i < queue.length; i++) {
					const q = queue[i];
					const row = this.queueListEl.createDiv({ cls: "ch-queue-row" });

					row.createSpan({
						cls: "ch-row-name",
						text: (i + 1) + ". " + this.getItemLabelLocal(q) + " - " + this.getItemModeName(q),
					});

					const removeBtn = row.createEl("button", { cls: "ch-btn-small", text: "x" });
					removeBtn.addEventListener("click", () => {
						this.plugin.removeFromQueue(i);
						this.refresh();
					});
				}
			}
		}

		const failedItems = this.plugin.getFailedItems();
		if (this.failedListEl) {
			this.failedListEl.setText("");
			if (failedItems.length > 0) {
				this.failedListEl.createDiv({
					cls: "ch-section-label ch-label-error",
					text: "Failed (" + failedItems.length + ")",
				});

				for (let i = 0; i < failedItems.length; i++) {
					const f = failedItems[i];
					const row = this.failedListEl.createDiv({ cls: "ch-queue-row" });

					const itemName = this.getItemLabelLocal(f.item);
					const shortErr = f.error.length > 60 ? f.error.slice(0, 60) + "..." : f.error;
					row.createSpan({ cls: "ch-row-name ch-row-name-muted", text: itemName + " - " + shortErr });

					const retryBtn = row.createEl("button", { cls: "ch-btn-small", text: "Retry" });
					retryBtn.addEventListener("click", () => {
						this.plugin.retryOne(i);
						this.refresh();
					});

					const dismissBtn = row.createEl("button", { cls: "ch-btn-small", text: "x" });
					dismissBtn.addEventListener("click", () => {
						this.plugin.dismissFailed(i);
						this.refresh();
					});
				}
			}
		}

		const completedItems = this.plugin.getCompletedItems();
		if (this.completedListEl) {
			this.completedListEl.setText("");
			if (completedItems.length > 0) {
				this.completedListEl.createDiv({
					cls: "ch-section-label ch-label-success",
					text: "Completed (" + completedItems.length + ")",
				});

				const shown = completedItems.slice(-20).reverse();
				for (const c of shown) {
					const row = this.completedListEl.createDiv({ cls: "ch-completed-row" });

					row.createSpan({ cls: "ch-row-name", text: this.getItemLabelLocal(c.item) });

					const secs = Math.round(c.elapsed / 1000);
					row.createSpan({ cls: "ch-row-stats", text: `${(c.chars / 1000).toFixed(1)}k chars, ${secs}s` });
				}

				if (completedItems.length > 20) {
					this.completedListEl.createDiv({
						cls: "ch-more-note",
						text: `...and ${completedItems.length - 20} more`,
					});
				}
			}
		}
	}

	onClose(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
		}
		this.contentEl.empty();
	}
}

// ─── Log Viewer Modal ────────────────────────────────────────────

export class LogViewerModal extends Modal {
	private interval: number | null = null;
	private pre: HTMLPreElement | null = null;
	private lastLen = -1;

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("ch-modal");
		setModalTitle(this, "Second Brain Builder logs");

		const btnRow = contentEl.createDiv({ cls: "ch-log-btn-row" });
		const copyBtn = btnRow.createEl("button", { text: "Copy to clipboard" });
		copyBtn.onclick = () => {
			void navigator.clipboard.writeText(logger.getLog());
			new Notice("Logs copied to clipboard");
		};
		const clearBtn = btnRow.createEl("button", { text: "Clear logs" });
		clearBtn.onclick = () => {
			logger.clear();
			this.lastLen = -1;
			this.refresh();
			new Notice("Logs cleared");
		};

		this.pre = contentEl.createEl("pre", { cls: "ch-log-pre" });

		this.refresh();
		this.interval = window.setInterval(() => this.refresh(), 1000);
	}

	private refresh() {
		if (!this.pre) return;
		const text = logger.getLog();
		if (text.length === this.lastLen) return;
		this.lastLen = text.length;
		this.pre.textContent = text || "No log entries yet.";
		this.pre.scrollTop = this.pre.scrollHeight;
	}

	onClose() {
		if (this.interval !== null) window.clearInterval(this.interval);
		this.contentEl.empty();
	}
}
