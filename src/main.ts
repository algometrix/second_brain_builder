import { App, Editor, EditorPosition, FileSystemAdapter, MarkdownView, Menu, MenuItem, Notice, Plugin, TFile, TFolder, normalizePath, requestUrl, RequestUrlResponse } from "obsidian";
import BUILTIN_MODES from "../modes.json";
import { ClaudeExplainerSettings, DEFAULT_SETTINGS, InlineActionConfig, NoteConfig, NoteMode, PendingLinkReplacement, PROVIDER_LABELS, QueueItem } from "./types";
import { INLINE_ACTIONS } from "./inline-actions";
import { APPEND_OUTPUT_RULES, INLINE_OUTPUT_RULES, getOutputRules } from "./output-rules";
import { spawnCli } from "./cli";
import { logger } from "./logger";
import { extractJsonArray, isNoteEffectivelyEmpty, sanitizeFilename } from "./utils";
import { fixCalloutCodeFences, fixCodeBlocks, fixCurrencyDollars, fixDataviewInlineQueries, fixDetailsBlocks, fixMermaidBlocks } from "./fixers";
import { FillNoteModal, FullNoteActionModal, InlineActionModal, NoteCreatorModal } from "./modals/generation";
import { AddTopicModal, ExpandFolderModal, FolderGeneratorModal, TopicGeneratorModal } from "./modals/folder";
import { FolderAnalysisModal, NoteAnalysisModal } from "./modals/analysis";
import { LogViewerModal, QueueStatusModal } from "./modals/queue";
import { ScaleCalculatorModal, ScaffoldWorkspaceModal } from "./modals/system-design";
import { ClaudeExplainerSettingTab } from "./settings-tab";

// ─── Plugin ──────────────────────────────────────────────────────

export default class ClaudeExplainerPlugin extends Plugin {
	settings: ClaudeExplainerSettings = DEFAULT_SETTINGS;
	private queue: QueueItem[] = [];
	private failedItems: { item: QueueItem; error: string; timestamp: number }[] = [];
	private completedItems: { item: QueueItem; chars: number; elapsed: number; timestamp: number }[] = [];
	private processingItem: QueueItem | null = null;
	private isProcessing = false;
	private statusBarEl: HTMLElement | null = null;
	private streamData = { currentOutput: "", startTime: 0 };

	getAllModes(): NoteMode[] {
		return [...(BUILTIN_MODES as NoteMode[]), ...this.settings.customModes];
	}

	getFullNoteModes(): NoteMode[] {
		return this.getAllModes().filter(m => m.fullNote);
	}

	getStandardModes(): NoteMode[] {
		return this.getAllModes().filter(m => !m.fullNote);
	}

	async onload() {
		await this.loadSettings();

		this.statusBarEl = this.addStatusBarItem();
		this.updateStatusBar();

		this.showFirstRunNotice();

		// ── Note creation command (multi-mode) ──
		this.addCommand({
			id: "explain-selection",
			name: "Explain selection with AI",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection().trim();
				if (!selection) {
					new Notice("Select some text first.");
					return;
				}
				const from = editor.getCursor("from");
				const to = editor.getCursor("to");
				new NoteCreatorModal(this.app, this.getStandardModes(), selection, this.settings.lastModeId || this.settings.defaultModeId, (configs) => {
					const linkReplacement = this.buildLinkReplacement(editor, from, to, selection, configs);
					for (const config of configs) {
						void this.enqueueNote(editor, view, selection, config, linkReplacement);
					}
				}, (modeId) => { void this.saveLastMode(modeId); }).open();
			},
		});

		// ── Inline action command (shows all actions) ──
		this.addCommand({
			id: "enhance-selection",
			name: "Enhance selection with AI",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection().trim();
				if (!selection) {
					new Notice("Select some text first.");
					return;
				}
				const from = editor.getCursor("from");
				const to = editor.getCursor("to");
				new InlineActionModal(this.app, INLINE_ACTIONS, selection, (config) => {
					this.enqueueInlineAction(editor, selection, config, from, to);
				}).open();
			},
		});

		// ── Individual inline action commands ──
		for (const action of INLINE_ACTIONS) {
			this.addCommand({
				id: `inline-${action.id}`,
				name: `${action.name} selection with AI`,
				editorCallback: (editor: Editor, view: MarkdownView) => {
					const selection = editor.getSelection().trim();
					if (!selection) {
						new Notice("Select some text first.");
						return;
					}
					const from = editor.getCursor("from");
					const to = editor.getCursor("to");
					new InlineActionModal(this.app, INLINE_ACTIONS, selection, (config) => {
						this.enqueueInlineAction(editor, selection, config, from, to);
					}, action).open();
				},
			});
		}

		// ── Queue viewer command ──
		this.addCommand({
			id: "view-queue",
			name: "View note generation queue",
			callback: () => {
				new QueueStatusModal(this.app, this).open();
			},
		});

		// ── Analyze current note command (fullNote modes) ──
		this.addCommand({
			id: "analyze-note",
			name: "Analyze current note with AI",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const file = view.file;
				if (!file) {
					new Notice("No active file.");
					return;
				}
				const fullNoteModes = this.getFullNoteModes();
				if (fullNoteModes.length === 0) {
					new Notice("No full-note analysis modes available.");
					return;
				}
				new FullNoteActionModal(this.app, fullNoteModes, file.basename, (mode, extraInstructions) => {
					void this.enqueueAppend(editor, file, mode, extraInstructions);
				}).open();
			},
		});

		// ── Generate notes from topic command ──
		this.addCommand({
			id: "generate-topic",
			name: "Generate notes from topic with AI",
			callback: () => {
				const activeFile = this.app.workspace.getActiveFile();
				const folderPath = activeFile?.parent?.path ?? "";
				const standardModes = this.getStandardModes();
				new TopicGeneratorModal(this.app, standardModes, folderPath, (topic, mode, isMulti, extraInstructions) => {
					void this.generateTopicNotes(topic, mode, isMulti, folderPath, extraInstructions);
				}).open();
			},
		});

		// ── Fill empty note command ──
		this.addCommand({
			id: "fill-empty-note",
			name: "Fill empty note with AI",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const file = view.file;
				if (!file) {
					new Notice("No active file.");
					return;
				}
				if (!isNoteEffectivelyEmpty(editor.getValue())) {
					new Notice("This note already has content. Use this command on an empty note.");
					return;
				}

				const { context, sources } = await this.getBacklinkContext(file);
				const standardModes = this.getStandardModes();

				new FillNoteModal(
					this.app,
					standardModes,
					file.basename,
					context,
					sources,
					this.settings.lastModeId || this.settings.defaultModeId,
					(mode, ctx, extraInstructions) => {
						void this.enqueueFillNote(file, mode, ctx, extraInstructions);
					},
					(modeId) => { void this.saveLastMode(modeId); },
				).open();
			},
		});

		// ── Scale calculator command ──
		this.addCommand({
			id: "scale-calculator",
			name: "Insert scale estimation table",
			editorCallback: (editor: Editor) => {
				new ScaleCalculatorModal(this.app, (md) => {
					const cursor = editor.getCursor();
					editor.replaceRange("\n" + md + "\n", cursor);
				}).open();
			},
		});

		// ── Scaffold system design workspace command ──
		this.addCommand({
			id: "scaffold-sd-workspace",
			name: "Scaffold system design workspace",
			callback: async () => {
				new ScaffoldWorkspaceModal(this.app, async (name, sections) => {
					await this.scaffoldWorkspace(name, sections);
				}).open();
			},
		});

		// ── Right-click context menu ──
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return;

				const selection = editor.getSelection().trim();
				const from = editor.getCursor("from");
				const to = editor.getCursor("to");

				if (selection) {
					const selLabel = selection.slice(0, 30) + (selection.length > 30 ? "..." : "");

					// Note creation entry
					menu.addItem((item) => {
						item.setTitle(`Create note from "${selLabel}"`)
							.setIcon("book-open")
							.onClick(() => {
								new NoteCreatorModal(this.app, this.getStandardModes(), selection, this.settings.lastModeId || this.settings.defaultModeId, (configs) => {
									const linkReplacement = this.buildLinkReplacement(editor, from, to, selection, configs);
									for (const config of configs) {
										void this.enqueueNote(editor, view, selection, config, linkReplacement);
									}
								}, (modeId) => { void this.saveLastMode(modeId); }).open();
							});
					});

					// Inline enhance entry (opens full action picker)
					menu.addItem((item) => {
						item.setTitle(`Enhance "${selLabel}" with AI`)
							.setIcon("wand")
							.onClick(() => {
								new InlineActionModal(this.app, INLINE_ACTIONS, selection, (config) => {
									this.enqueueInlineAction(editor, selection, config, from, to);
								}).open();
							});
					});
				}

				if (selection) {
					// Individual inline action entries in a submenu
					menu.addItem((item) => {
						const sub = (item.setTitle("AI actions")
							.setIcon("sparkles") as MenuItem & { setSubmenu(): Menu })
							.setSubmenu();

						for (const action of INLINE_ACTIONS) {
							sub.addItem((subItem) => {
								subItem.setTitle(action.name)
									.setIcon(action.icon)
									.onClick(() => {
										new InlineActionModal(this.app, INLINE_ACTIONS, selection, (config) => {
											this.enqueueInlineAction(editor, selection, config, from, to);
										}, action).open();
									});
							});
						}
					});
				}

				// Analyze note entry (always visible, no selection required)
				const file = view.file;
				if (file) {
					const fullNoteModes = this.getFullNoteModes();
					if (fullNoteModes.length > 0) {
						menu.addItem((item) => {
							item.setTitle("Analyze this note with AI")
								.setIcon("brain")
								.onClick(() => {
									new FullNoteActionModal(this.app, fullNoteModes, file.basename, (mode, extraInstructions) => {
										void this.enqueueAppend(editor, file, mode, extraInstructions);
									}).open();
								});
						});
					}

					// Fill empty note entry
					if (isNoteEffectivelyEmpty(editor.getValue())) {
						menu.addItem((item) => {
							item.setTitle("Fill this empty note with AI")
								.setIcon("file-plus")
								.onClick(async () => {
									const { context, sources } = await this.getBacklinkContext(file);
									const standardModes = this.getStandardModes();
									new FillNoteModal(
										this.app,
										standardModes,
										file.basename,
										context,
										sources,
										this.settings.lastModeId || this.settings.defaultModeId,
										(mode, ctx, extraInstructions) => {
											void this.enqueueFillNote(file, mode, ctx, extraInstructions);
										},
										(modeId) => { void this.saveLastMode(modeId); },
									).open();
								});
						});
					}
				}
			})
		);

		// ── Folder right-click: generate knowledge notes ─��
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFolder)) return;

				menu.addItem((item) => {
					item.setTitle("Generate knowledge notes with AI")
						.setIcon("sparkles")
						.onClick(() => {
							const standardModes = this.getStandardModes();
							new FolderGeneratorModal(
								this.app,
								standardModes,
								file.path,
								file.name,
								(scenario, mode, extraInstructions) => {
									void this.generateKnowledgeNotes(scenario, mode, file.path, extraInstructions);
								},
							).open();
						});
				});

				menu.addItem((item) => {
					item.setTitle("Add topic to folder with AI")
						.setIcon("file-plus")
						.onClick(() => {
							const standardModes = this.getStandardModes();
							new AddTopicModal(
								this.app,
								standardModes,
								file.path,
								file.name,
								(topic, mode, extraInstructions) => {
									void this.addTopicToFolder(topic, mode, file, extraInstructions);
								},
							).open();
						});
				});

				menu.addItem((item) => {
					item.setTitle("Expand folder with more notes")
						.setIcon("layers")
						.onClick(() => {
							const standardModes = this.getStandardModes();
							const existingNotes = file.children
								.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
								.map(f => f.basename);
							new ExpandFolderModal(
								this.app,
								standardModes,
								file.path,
								file.name,
								existingNotes,
								(direction, mode, extraInstructions) => {
									void this.expandFolderNotes(direction, mode, file, extraInstructions);
								},
							).open();
						});
				});

				menu.addItem((item) => {
					item.setTitle("Analyze folder with AI")
						.setIcon("search")
						.onClick(() => {
							const analysisModes = this.getAllModes().filter(m => m.analyzesExisting);
							new FolderAnalysisModal(
								this.app,
								analysisModes,
								file.path,
								file.name,
								(mode, extraContent) => {
									void this.analyzeFolderNotes(file, mode, extraContent);
								},
							).open();
						});
				});
			})
		);

		// ── Note right-click (file-menu): analyze note ──
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;

				menu.addItem((item) => {
					item.setTitle("Analyze note with AI")
						.setIcon("search")
						.onClick(() => {
							const analysisModes = this.getAllModes().filter(m => m.analyzesExisting);
							new NoteAnalysisModal(
								this.app,
								analysisModes,
								file,
								(mode, extraContent) => {
									void this.analyzeExistingNote(file, mode, extraContent);
								},
							).open();
						});
				});
			})
		);

		// ── Generate knowledge notes command ──
		this.addCommand({
			id: "generate-knowledge-notes",
			name: "Generate knowledge notes in folder with AI",
			callback: () => {
				const activeFile = this.app.workspace.getActiveFile();
				const folderPath = activeFile?.parent?.path ?? "";
				const folderName = activeFile?.parent?.name ?? "vault root";
				const standardModes = this.getStandardModes();
				new FolderGeneratorModal(
					this.app,
					standardModes,
					folderPath,
					folderName,
					(scenario, mode, extraInstructions) => {
						void this.generateKnowledgeNotes(scenario, mode, folderPath, extraInstructions);
					},
				).open();
			},
		});

		this.addCommand({
			id: "view-logs",
			name: "View logs",
			callback: () => {
				new LogViewerModal(this.app).open();
			},
		});

		this.addSettingTab(new ClaudeExplainerSettingTab(this.app, this));

		logger.info("Plugin loaded");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<ClaudeExplainerSettings> | null);
		logger.setEnabled(this.settings.enableLogging);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getQueue(): QueueItem[] {
		return [...this.queue];
	}

	getProcessingItem(): QueueItem | null {
		return this.processingItem;
	}

	getStreamData(): { currentOutput: string; startTime: number } {
		return this.streamData;
	}

	async saveLastMode(modeId: string) {
		this.settings.lastModeId = modeId;
		await this.saveSettings();
	}

	removeFromQueue(index: number) {
		this.queue.splice(index, 1);
		this.updateStatusBar();
	}

	clearQueue() {
		this.queue = [];
		this.updateStatusBar();
		new Notice("Queue cleared.");
	}

	getFailedItems(): { item: QueueItem; error: string; timestamp: number }[] {
		return [...this.failedItems];
	}

	getCompletedItems(): { item: QueueItem; chars: number; elapsed: number; timestamp: number }[] {
		return [...this.completedItems];
	}

	retryFailed() {
		if (this.failedItems.length === 0) {
			new Notice("No failed items to retry.");
			return;
		}
		const count = this.failedItems.length;
		for (const f of this.failedItems) {
			this.queue.push(f.item);
		}
		this.failedItems = [];
		this.updateStatusBar();
		new Notice(`Re-queued ${count} failed item(s).`);
		if (!this.isProcessing) {
			void this.processQueue();
		}
	}

	retryOne(index: number) {
		if (index < 0 || index >= this.failedItems.length) return;
		const [removed] = this.failedItems.splice(index, 1);
		this.queue.push(removed.item);
		this.updateStatusBar();
		new Notice(`Re-queued "${this.getItemLabel(removed.item)}".`);
		if (!this.isProcessing) {
			void this.processQueue();
		}
	}

	dismissFailed(index: number) {
		if (index < 0 || index >= this.failedItems.length) return;
		this.failedItems.splice(index, 1);
		this.updateStatusBar();
	}

	clearFailed() {
		this.failedItems = [];
		this.updateStatusBar();
	}

	private getItemLabel(item: QueueItem): string {
		if (item.type === "note" || item.type === "topic-note") return item.noteName;
		if (item.type === "append") return `${item.mode.name} on ${item.fileName}`;
		return item.action.name;
	}

	private updateStatusBar() {
		if (!this.statusBarEl) return;
		const total = this.queue.length + (this.isProcessing ? 1 : 0);
		if (total === 0) {
			this.statusBarEl.setText("");
		} else if (this.isProcessing && this.processingItem) {
			let label: string;
			if (this.processingItem.type === "note" || this.processingItem.type === "topic-note") {
				label = this.processingItem.noteName;
			} else if (this.processingItem.type === "append") {
				label = `[${this.processingItem.mode.name}] ${this.processingItem.fileName}`;
			} else {
				label = `[${this.processingItem.action.name}]`;
			}
			const failSuffix = this.failedItems.length > 0 ? `, ${this.failedItems.length} failed` : "";
			const ai = PROVIDER_LABELS[this.settings.aiProvider];
			this.statusBarEl.setText(`${ai}: generating "${label}" (${this.queue.length} queued${failSuffix})`);
		} else if (this.failedItems.length > 0) {
			const ai = PROVIDER_LABELS[this.settings.aiProvider];
			this.statusBarEl.setText(`${ai}: ${this.failedItems.length} failed (click to retry)`);
		} else {
			const ai = PROVIDER_LABELS[this.settings.aiProvider];
			this.statusBarEl.setText(`${ai}: ${this.queue.length} in queue`);
		}
	}

	private showFirstRunNotice() {
		if (this.settings.setupNoticeShown) return;
		this.settings.setupNoticeShown = true;
		void this.saveSettings();
		const notice = new Notice(
			"Second Brain Builder needs an AI backend before first use: the Claude Code CLI (default) or a free local Ollama server. Click here to open settings and follow the setup guide.",
			0
		);
		notice.messageEl.addEventListener("click", () => {
			notice.hide();
			this.openSettingsTab();
		});
	}

	private openSettingsTab() {
		const appWithSettings = this.app as App & {
			setting: { open(): void; openTabById(id: string): void };
		};
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(this.manifest.id);
	}

	private buildLinkReplacement(
		editor: Editor,
		from: EditorPosition,
		to: EditorPosition,
		selection: string,
		configs: NoteConfig[]
	): PendingLinkReplacement {
		return {
			editor,
			from,
			to,
			selection,
			linksText: configs.map(c => `[[${c.title}]]`).join(" | "),
			applied: false,
		};
	}

	private applyLinkReplacement(replacement: PendingLinkReplacement | undefined) {
		if (!replacement || replacement.applied) return;
		replacement.applied = true;
		try {
			if (replacement.editor.getRange(replacement.from, replacement.to) !== replacement.selection) {
				logger.info("Selection changed since queuing; skipping wiki-link insertion.");
				return;
			}
			replacement.editor.replaceRange(replacement.linksText, replacement.from, replacement.to);
		} catch (err) {
			logger.error(`Could not insert wiki-link: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async enqueueNote(editor: Editor, view: MarkdownView, selection: string, config: NoteConfig, linkReplacement?: PendingLinkReplacement) {
		const file = view.file;
		if (!file) {
			new Notice("No active file.");
			return;
		}

		const folderPath = file.parent?.path ?? "";
		const noteName = config.title;
		if (!noteName) {
			new Notice("Invalid note title.");
			return;
		}

		const newNotePath = normalizePath(
			folderPath ? `${folderPath}/${noteName}.md` : `${noteName}.md`
		);

		const existing = this.app.vault.getAbstractFileByPath(newNotePath);
		if (existing instanceof TFile) {
			const existingContent = await this.app.vault.read(existing);
			if (!isNoteEffectivelyEmpty(existingContent)) {
				this.applyLinkReplacement(linkReplacement);
				new Notice(`Note "${noteName}" already has content. Linked to it.`);
				return;
			}
		}

		const contextLines = editor.getValue();
		const contextSnippet = contextLines.length > 2000
			? contextLines.slice(0, 2000) + "\n...(truncated)"
			: contextLines;

		let fullPrompt = config.mode.prompt
			.replace(/\{selection\}/g, selection.replace(/"/g, '\\"'))
			.replace(/\{context\}/g, contextSnippet.replace(/"/g, '\\"'))
			+ getOutputRules();

		if (config.extraInstructions) {
			fullPrompt += `\n\nAdditional instructions from the user:\n${config.extraInstructions}`;
		}

		this.queue.push({
			type: "note",
			selection,
			noteName,
			newNotePath,
			fullPrompt,
			mode: config.mode,
			editor,
			linkReplacement,
		});

		const pos = this.queue.length + (this.isProcessing ? 1 : 0);
		new Notice(`Queued "${noteName}" (${config.mode.name}) - position ${pos}`);
		this.updateStatusBar();

		if (!this.isProcessing) {
			void this.processQueue();
		}
	}

	private enqueueInlineAction(editor: Editor, selection: string, config: InlineActionConfig, from: EditorPosition, to: EditorPosition) {
		const contextLines = editor.getValue();
		const contextSnippet = contextLines.length > 2000
			? contextLines.slice(0, 2000) + "\n...(truncated)"
			: contextLines;

		let fullPrompt = config.action.prompt
			.replace(/\{selection\}/g, selection.replace(/"/g, '\\"'))
			.replace(/\{context\}/g, contextSnippet.replace(/"/g, '\\"'))
			+ INLINE_OUTPUT_RULES;

		if (config.extraInstructions) {
			fullPrompt += `\n\nAdditional instructions from the user:\n${config.extraInstructions}`;
		}

		this.queue.push({
			type: "inline",
			selection,
			fullPrompt,
			action: config.action,
			editor,
			from,
			to,
			insertionMode: config.insertionMode,
		});

		const pos = this.queue.length + (this.isProcessing ? 1 : 0);
		new Notice(`Queued "${config.action.name}" (${config.insertionMode}) - position ${pos}`);
		this.updateStatusBar();

		if (!this.isProcessing) {
			void this.processQueue();
		}
	}

	private async getBacklinkContext(file: TFile): Promise<{ context: string; sources: string[] }> {
		const sources: string[] = [];
		const contextParts: string[] = [];
		const targetPath = file.path;
		const resolvedLinks = this.app.metadataCache.resolvedLinks;

		for (const sourcePath of Object.keys(resolvedLinks)) {
			const links = resolvedLinks[sourcePath];
			if (links && links[targetPath]) {
				const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
				if (sourceFile instanceof TFile) {
					sources.push(sourceFile.basename);
					const content = await this.app.vault.read(sourceFile);
					const snippet = content.length > 1500
						? content.slice(0, 1500) + "\n...(truncated)"
						: content;
					contextParts.push(`From [[${sourceFile.basename}]]:\n${snippet}`);
				}
			}
			if (sources.length >= 5) break;
		}

		const context = contextParts.join("\n\n---\n\n");
		return { context, sources };
	}

	private async enqueueFillNote(file: TFile, mode: NoteMode, context: string, extraInstructions: string) {
		const topic = file.basename;

		const contextBlock = context.length > 0
			? context
			: "No existing context provided. Generate a comprehensive note on this topic from scratch.";

		let fullPrompt = mode.prompt
			.replace(/\{selection\}/g, topic.replace(/"/g, '\\"'))
			.replace(/\{context\}/g, contextBlock.replace(/"/g, '\\"'))
			+ getOutputRules();

		if (extraInstructions) {
			fullPrompt += `\n\nAdditional instructions from the user:\n${extraInstructions}`;
		}

		this.queue.push({
			type: "topic-note",
			noteName: topic,
			newNotePath: file.path,
			fullPrompt,
			mode,
		});

		const pos = this.queue.length + (this.isProcessing ? 1 : 0);
		new Notice(`Queued "${topic}" (${mode.name}) - position ${pos}`);
		this.updateStatusBar();

		if (!this.isProcessing) {
			void this.processQueue();
		}
	}

	private async enqueueAppend(editor: Editor, file: TFile, mode: NoteMode, extraInstructions: string) {
		const fullContent = editor.getValue();

		let fullPrompt = mode.prompt
			.replace(/\{selection\}/g, "")
			.replace(/\{context\}/g, fullContent.replace(/"/g, '\\"'))
			+ APPEND_OUTPUT_RULES;

		if (extraInstructions) {
			fullPrompt += `\n\nAdditional instructions from the user:\n${extraInstructions}`;
		}

		this.queue.push({
			type: "append",
			filePath: file.path,
			fileName: file.basename,
			fullPrompt,
			mode,
		});

		const pos = this.queue.length + (this.isProcessing ? 1 : 0);
		new Notice(`Queued "${mode.name}" for ${file.basename} - position ${pos}`);
		this.updateStatusBar();

		if (!this.isProcessing) {
			void this.processQueue();
		}
	}

	private async scaffoldWorkspace(name: string, sections: string[]) {
		const basePath = normalizePath(name);

		const sectionDescriptions: Record<string, string> = {
			Systems: "Full system design notes. Use the **System Design** mode to generate notes here.",
			Patterns: "Design pattern cards. Use the **SD Concept** mode with pattern topics (Saga, CQRS, Event Sourcing).",
			Components: "Technology deep-dives. Use the **SD Concept** mode with technology topics (Redis, Kafka, Postgres).",
			Failures: "Failure mode analysis. Use the **SD Concept** mode with failure topics (Cache Stampede, Split Brain).",
			Tradeoffs: "Technology comparisons. Use the **SD Concept** or **Compare & Contrast** mode.",
			Simulations: "Request flow traces and path simulations.",
			Glossary: "Term definitions and concept maps. Use the **Glossary Builder** mode.",
		};

		try {
			for (const section of sections) {
				const folderPath = normalizePath(`${basePath}/${section}`);
				const existing = this.app.vault.getAbstractFileByPath(folderPath);
				if (!existing) {
					await this.app.vault.createFolder(folderPath);
				}
			}

			const indexLines = [`# ${name}\n`];
			indexLines.push("A structured workspace for system design study and architecture notes.\n");

			for (const section of sections) {
				const desc = sectionDescriptions[section] || "";
				indexLines.push(`## [[${section}]]\n`);
				indexLines.push(`${desc}\n`);
			}

			indexLines.push("---\n");
			indexLines.push("*Scaffold created by Second Brain Builder.*\n");

			const indexPath = normalizePath(`${basePath}/${name}.md`);
			const existingIndex = this.app.vault.getAbstractFileByPath(indexPath);
			if (!existingIndex) {
				await this.app.vault.create(indexPath, indexLines.join("\n"));
			}

			new Notice(`Workspace "${name}" created with ${sections.length} sections.`);

			const file = this.app.vault.getAbstractFileByPath(indexPath);
			if (file instanceof TFile) {
				await this.app.workspace.getLeaf().openFile(file);
			}
		} catch (err) {
			new Notice(`Error creating workspace: ${err}`);
		}
	}

	private async generateTopicNotes(topic: string, mode: NoteMode, isMulti: boolean, folderPath: string, extraInstructions: string) {
		const sanitizedTopic = sanitizeFilename(topic);

		if (!isMulti) {
			const noteName = sanitizedTopic;
			const newNotePath = normalizePath(
				folderPath ? `${folderPath}/${noteName}.md` : `${noteName}.md`
			);

			const existing = this.app.vault.getAbstractFileByPath(newNotePath);
			if (existing instanceof TFile) {
				const existingContent = await this.app.vault.read(existing);
				if (!isNoteEffectivelyEmpty(existingContent)) {
					new Notice(`Note "${noteName}" already has content.`);
					return;
				}
			}

			const contextBlock = "This note is being created from scratch. There is no existing source note.";
			let fullPrompt = mode.prompt
				.replace(/\{selection\}/g, topic.replace(/"/g, '\\"'))
				.replace(/\{context\}/g, contextBlock)
				+ getOutputRules();

			if (extraInstructions) {
				fullPrompt += `\n\nAdditional instructions from the user:\n${extraInstructions}`;
			}

			this.queue.push({
				type: "topic-note",
				noteName,
				newNotePath,
				fullPrompt,
				mode,
			});

			const pos = this.queue.length + (this.isProcessing ? 1 : 0);
			new Notice(`Queued "${noteName}" (${mode.name}) - position ${pos}`);
			this.updateStatusBar();

			if (!this.isProcessing) {
				void this.processQueue();
			}
			return;
		}

		// Multi-note: decompose topic, create folder + index + sub-notes
		new Notice(`Planning notes for "${topic}"... This may take a moment.`);

		const decompositionPrompt = `You are a curriculum designer creating a structured set of study notes.

Topic: "${topic}"

Break this topic down into a logical set of 4-10 sub-topics that together provide comprehensive coverage. Each sub-topic should be a self-contained note that can link to related sub-topics.

Return ONLY valid JSON - no markdown code fences, no explanation, no text before or after. The format:
[
  {"title": "Sub-topic Title", "description": "Brief description of what this note covers", "related": ["Other Sub-topic Title"]}
]

Rules:
- Order sub-topics from foundational to advanced
- Titles should be clear, standalone note titles (3-8 words)
- "related" should reference other sub-topic titles from your list that should be cross-linked
- Do not include the main topic itself as a sub-topic - it will be the index note
${extraInstructions ? `\nAdditional context: ${extraInstructions}` : ""}`;

		try {
			const rawResponse = await this.runClaude(decompositionPrompt);

			let subtopics: { title: string; description: string; related: string[] }[];
			try {
				const jsonStr = extractJsonArray(rawResponse);
				subtopics = JSON.parse(jsonStr) as typeof subtopics;
			} catch {
				new Notice("Failed to parse topic decomposition. Falling back to single note.", 8000);
				console.error("Topic decomposition parse error. Raw response:", rawResponse);
				void this.generateTopicNotes(topic, mode, false, folderPath, extraInstructions);
				return;
			}

			if (!Array.isArray(subtopics) || subtopics.length === 0) {
				new Notice("No sub-topics generated. Falling back to single note.", 5000);
				void this.generateTopicNotes(topic, mode, false, folderPath, extraInstructions);
				return;
			}

			// Create folder
			const topicFolder = normalizePath(
				folderPath ? `${folderPath}/${sanitizedTopic}` : sanitizedTopic
			);
			const existingFolder = this.app.vault.getAbstractFileByPath(topicFolder);
			if (!existingFolder) {
				await this.app.vault.createFolder(topicFolder);
			}

			// Build sub-topic list for context
			const subtopicList = subtopics
				.map(s => `- [[${sanitizeFilename(s.title)}]]: ${s.description}`)
				.join("\n");

			// Create index note
			const indexPrompt = `You are creating an index/hub note for a series of study notes on "${topic}".

The series contains these notes:
${subtopicList}

Write an index note that:
1. Opens with a brief overview of the topic (2-3 paragraphs)
2. Lists all notes in the series using [[Note Title]] wiki-link format with brief descriptions
3. Suggests a recommended reading order
4. Includes a mermaid diagram showing how the notes relate to each other

IMPORTANT mermaid syntax rules: always wrap node labels and subgraph titles in double quotes. Use plain hyphens instead of em dashes. Keep mermaid syntax strictly ASCII-safe. Never use markdown list syntax inside labels (no "- item", "* item", "1. step", or "1) step"); for numbered steps in edge labels use a colon "1:" not "1." to avoid "Unsupported markdown: list" errors.

Use [[Note Title]] format for all links to sub-notes.` + getOutputRules();

			const indexPath = normalizePath(`${topicFolder}/${sanitizedTopic}.md`);
			this.queue.push({
				type: "topic-note",
				noteName: sanitizedTopic + " (index)",
				newNotePath: indexPath,
				fullPrompt: indexPrompt,
				mode,
			});

			// Queue each sub-note
			for (const sub of subtopics) {
				const subName = sanitizeFilename(sub.title);
				const subPath = normalizePath(`${topicFolder}/${subName}.md`);

				const siblingContext = `This note is part of a series on "${topic}". Other notes in this series:\n${subtopicList}\n\nThis specific note should focus on: ${sub.description}`;

				let subPrompt = mode.prompt
					.replace(/\{selection\}/g, sub.title.replace(/"/g, '\\"'))
					.replace(/\{context\}/g, siblingContext.replace(/"/g, '\\"'))
					+ getOutputRules();

				if (extraInstructions) {
					subPrompt += `\n\nAdditional instructions from the user:\n${extraInstructions}`;
				}

				subPrompt += `\n\nIMPORTANT: Link to related notes in this series using [[WikiLink]] format where relevant. Related notes: ${sub.related.map(r => `[[${sanitizeFilename(r)}]]`).join(", ")}`;

				this.queue.push({
					type: "topic-note",
					noteName: subName,
					newNotePath: subPath,
					fullPrompt: subPrompt,
					mode,
				});
			}

			const total = subtopics.length + 1;
			new Notice(`Queued ${total} notes for "${topic}" (1 index + ${subtopics.length} sub-notes)`);
			this.updateStatusBar();

			if (!this.isProcessing) {
				void this.processQueue();
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Failed to plan topic notes: ${msg}`, 8000);
			console.error("Topic planning error:", err);
		}
	}

	private async generateKnowledgeNotes(scenario: string, mode: NoteMode, folderPath: string, extraInstructions: string) {
		new Notice(`Planning knowledge notes... This may take a moment.`);
		logger.info(`Knowledge notes: scenario="${scenario.slice(0, 80)}...", mode=${mode.id}, folder=${folderPath}`);

		const decompositionGuide = mode.folderDecompositionGuide
			? `\n\nDOMAIN-SPECIFIC GUIDANCE for "${mode.name}" mode:\n${mode.folderDecompositionGuide}`
			: "";

		const decompositionPrompt = `You are an expert curriculum designer creating a structured set of deep-dive study notes.

The user wants to learn about the following scenario/topic:

"${scenario}"

The notes will be written in the "${mode.name}" style (${mode.description}).${decompositionGuide}

Break this into a logical set of 8-15 concept notes that together provide comprehensive, book-level coverage. Each note should deep-dive into ONE concept and be self-contained while linking to related notes.

Return ONLY valid JSON - no markdown code fences, no explanation, no text before or after. The format:
[
  {"title": "Note Title", "scope": "2-3 sentence description of what this specific note covers in depth", "related": ["Other Note Title"], "order": 1}
]

Rules:
- Order notes from foundational to advanced (use the "order" field, starting at 1)
- Titles should be clear, standalone note titles (3-8 words)
- "scope" should describe what the note covers in enough detail to guide a thorough write-up
- "related" should reference other note titles from your list for cross-linking
- Cover the topic comprehensively - imagine condensing the best chapters from major reference books into these notes
- Include both conceptual notes AND practical/applied notes (e.g. a request flow trace, a worked example, a comparison)
- Do not include an index or overview note - that will be generated separately
${extraInstructions ? `\nAdditional context from the user: ${extraInstructions}` : ""}`;

		try {
			const rawResponse = await this.runClaude(decompositionPrompt);

			let subtopics: { title: string; scope: string; related: string[]; order: number }[];
			try {
				const jsonStr = extractJsonArray(rawResponse);
				subtopics = JSON.parse(jsonStr) as typeof subtopics;
			} catch {
				new Notice("Failed to parse note plan. Check logs for details.", 8000);
				logger.error("Knowledge notes parse error. Raw response: " + rawResponse.slice(0, 500));
				return;
			}

			if (!Array.isArray(subtopics) || subtopics.length === 0) {
				new Notice("No notes were planned. Try rephrasing the scenario.", 5000);
				return;
			}

			subtopics.sort((a, b) => (a.order || 0) - (b.order || 0));

			const existingFolder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!existingFolder) {
				await this.app.vault.createFolder(folderPath);
			}

			const subtopicList = subtopics
				.map(s => `- [[${sanitizeFilename(s.title)}]]: ${s.scope}`)
				.join("\n");

			const scenarioForIndex = scenario.length > 4000
				? scenario.slice(0, 4000) + "\n...(truncated)"
				: scenario;

			const indexName = folderPath.split("/").pop() || "Index";
			const indexPrompt = `You are creating an index/hub note for a series of deep-dive study notes.

The user's original scenario/prompt was:
"${scenarioForIndex}"

The series contains these notes (in recommended reading order):
${subtopicList}

Write an index note that:
1. Opens with a concise overview of the scenario and what the reader will learn (2-3 short paragraphs)
2. Lists all notes in the series using [[Note Title]] wiki-link format, grouped logically, with one-line descriptions
3. Suggests a recommended reading order with brief rationale
4. Includes a mermaid diagram showing how the notes relate to each other (use subgraphs to group related notes)

IMPORTANT mermaid syntax rules: always wrap node labels and subgraph titles in double quotes. Use plain hyphens instead of em dashes. Keep mermaid syntax strictly ASCII-safe. Never use markdown list syntax inside labels (no "- item", "* item", "1. step", or "1) step"); for numbered steps in edge labels use a colon "1:" not "1." to avoid "Unsupported markdown: list" errors.

Use [[Note Title]] format for all links to sub-notes.` + getOutputRules();

			const indexPath = normalizePath(`${folderPath}/${sanitizeFilename(indexName)}.md`);
			const existingIndex = this.app.vault.getAbstractFileByPath(indexPath);
			if (!existingIndex) {
				this.queue.push({
					type: "topic-note",
					noteName: sanitizeFilename(indexName) + " (index)",
					newNotePath: indexPath,
					fullPrompt: indexPrompt,
					mode,
				});
			}

			const scenarioSnippet = scenario.length > 2000
				? scenario.slice(0, 2000) + "\n...(truncated)"
				: scenario;

			for (const sub of subtopics) {
				const subName = sanitizeFilename(sub.title);
				const subPath = normalizePath(`${folderPath}/${subName}.md`);

				const existingSub = this.app.vault.getAbstractFileByPath(subPath);
				if (existingSub instanceof TFile) {
					const content = await this.app.vault.read(existingSub);
					if (!isNoteEffectivelyEmpty(content)) {
						logger.info(`Skipping "${subName}" - already has content`);
						continue;
					}
				}

				const siblingContext = `This note is part of a deep-dive series. The user's scenario/prompt was:\n"${scenarioSnippet}"\n\nOther notes in this series:\n${subtopicList}\n\nThis specific note should focus on: ${sub.scope}\n\nGround your explanations in the context of the user's scenario where relevant. Make connections to the other notes in the series.`;

				let subPrompt = mode.prompt
					.replace(/\{selection\}/g, sub.title.replace(/"/g, '\\"'))
					.replace(/\{context\}/g, siblingContext.replace(/"/g, '\\"'))
					+ getOutputRules();

				if (extraInstructions) {
					subPrompt += `\n\nAdditional instructions from the user:\n${extraInstructions}`;
				}

				const relatedLinks = sub.related.map(r => `[[${sanitizeFilename(r)}]]`).join(", ");
				subPrompt += `\n\nIMPORTANT: Link to related notes in this series using [[WikiLink]] format where relevant. Related notes: ${relatedLinks}`;

				this.queue.push({
					type: "topic-note",
					noteName: subName,
					newNotePath: subPath,
					fullPrompt: subPrompt,
					mode,
				});
			}

			const total = this.queue.length;
			new Notice(`Queued ${total} notes for knowledge series (${subtopics.length} concepts + index)`);
			this.updateStatusBar();

			if (!this.isProcessing) {
				void this.processQueue();
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Failed to plan knowledge notes: ${msg}`, 8000);
			logger.error("Knowledge notes planning error: " + msg);
		}
	}

	private async addTopicToFolder(topic: string, mode: NoteMode, folder: TFolder, extraInstructions: string) {
		const files = folder.children.filter(
			(f): f is TFile => f instanceof TFile && f.extension === "md"
		);

		let siblingContext = "";
		const siblingList: string[] = [];
		for (const f of files) {
			const content = await this.app.vault.read(f);
			if (!isNoteEffectivelyEmpty(content)) {
				siblingList.push(`- [[${f.basename}]]`);
				const snippet = content.length > 2000 ? content.slice(0, 2000) + "\n..." : content;
				siblingContext += `\n\n=== ${f.basename} ===\n${snippet}`;
			}
		}

		const contextSnippet = siblingContext.length > 12000
			? siblingContext.slice(0, 12000) + "\n...(truncated)"
			: siblingContext;

		const noteName = sanitizeFilename(topic.split("\n")[0].trim());
		const notePath = normalizePath(`${folder.path}/${noteName}.md`);

		const existing = this.app.vault.getAbstractFileByPath(notePath);
		if (existing instanceof TFile) {
			const existingContent = await this.app.vault.read(existing);
			if (!isNoteEffectivelyEmpty(existingContent)) {
				new Notice(`"${noteName}" already has content.`);
				return;
			}
		}

		const fullContext = `This note is being added to an existing series in the folder "${folder.name}". The folder already contains these notes:\n${siblingList.join("\n")}\n\nExisting notes content for context:\n${contextSnippet}\n\nWrite a new note on "${topic}" that fits naturally into this series. Cross-link to existing notes using [[WikiLink]] format where relevant. Do not repeat what's already covered in the existing notes. Add new depth and perspective.`;

		let fullPrompt = mode.prompt
			.replace(/\{selection\}/g, topic.replace(/"/g, '\\"'))
			.replace(/\{context\}/g, fullContext.replace(/"/g, '\\"'))
			+ getOutputRules();

		if (extraInstructions) {
			fullPrompt += `\n\nAdditional instructions from the user:\n${extraInstructions}`;
		}

		this.queue.push({
			type: "topic-note",
			noteName,
			newNotePath: notePath,
			fullPrompt,
			mode,
			renameFromContent: true,
		});

		const pos = this.queue.length + (this.isProcessing ? 1 : 0);
		new Notice(`Queued "${noteName}" (${mode.name}) - position ${pos}. Using ${files.length} existing notes as context.`);
		this.updateStatusBar();

		if (!this.isProcessing) {
			void this.processQueue();
		}
	}

	private async expandFolderNotes(direction: string, mode: NoteMode, folder: TFolder, extraInstructions: string) {
		new Notice(`Planning new notes for "${folder.name}"... This may take a moment.`);
		logger.info(`Expand folder: direction="${direction.slice(0, 80)}...", mode=${mode.id}, folder=${folder.path}`);

		const files = folder.children.filter(
			(f): f is TFile => f instanceof TFile && f.extension === "md"
		);

		const existingTitles: string[] = [];
		let existingSummary = "";
		for (const f of files) {
			const content = await this.app.vault.read(f);
			if (!isNoteEffectivelyEmpty(content)) {
				existingTitles.push(f.basename);
				const firstLines = content.split("\n").slice(0, 30).join("\n");
				existingSummary += `\n- "${f.basename}": ${firstLines.slice(0, 300)}`;
			}
		}

		const decompositionGuide = mode.folderDecompositionGuide
			? `\n\nDOMAIN-SPECIFIC GUIDANCE for "${mode.name}" mode:\n${mode.folderDecompositionGuide}`
			: "";

		const decompositionPrompt = `You are an expert curriculum designer expanding an existing set of study notes.

The folder "${folder.name}" already contains these notes:
${existingTitles.map(t => `- "${t}"`).join("\n")}

Brief summaries of existing notes:${existingSummary}

The user wants to ADD NEW notes on the following topic/direction:
"${direction}"

The new notes will be written in the "${mode.name}" style (${mode.description}).${decompositionGuide}

Plan 4-10 NEW notes that complement the existing ones. Do NOT plan notes that duplicate or significantly overlap with existing notes.

Return ONLY valid JSON - no markdown code fences, no explanation, no text before or after. The format:
[
  {"title": "Note Title", "scope": "2-3 sentence description of what this specific note covers in depth", "related": ["Other Note Title"], "order": 1}
]

Rules:
- Every title must be DIFFERENT from all existing notes listed above
- Order from foundational to advanced (use the "order" field, starting at 1)
- Titles should be clear, standalone note titles (3-8 words)
- "related" can reference both NEW notes and EXISTING notes for cross-linking
- Focus specifically on the direction the user requested
- Do not rehash what the existing notes already cover
${extraInstructions ? `\nAdditional context from the user: ${extraInstructions}` : ""}`;

		try {
			const rawResponse = await this.runClaude(decompositionPrompt);

			let subtopics: { title: string; scope: string; related: string[]; order: number }[];
			try {
				const jsonStr = extractJsonArray(rawResponse);
				subtopics = JSON.parse(jsonStr) as typeof subtopics;
			} catch {
				new Notice("Failed to parse note plan. Check logs for details.", 8000);
				logger.error("Expand folder parse error. Raw response: " + rawResponse.slice(0, 500));
				return;
			}

			if (!Array.isArray(subtopics) || subtopics.length === 0) {
				new Notice("No new notes were planned. Try rephrasing the direction.", 5000);
				return;
			}

			subtopics.sort((a, b) => (a.order || 0) - (b.order || 0));

			// Filter out any that collide with existing notes
			const existingSet = new Set(existingTitles.map(t => t.toLowerCase()));
			subtopics = subtopics.filter(s => {
				const name = sanitizeFilename(s.title).toLowerCase();
				if (existingSet.has(name)) {
					logger.info(`Skipping planned note "${s.title}" - already exists`);
					return false;
				}
				return true;
			});

			if (subtopics.length === 0) {
				new Notice("All planned notes already exist in this folder.", 5000);
				return;
			}

			const allNotes = [
				...existingTitles.map(t => `- [[${t}]] (existing)`),
				...subtopics.map(s => `- [[${sanitizeFilename(s.title)}]]: ${s.scope} (new)`),
			].join("\n");

			const directionSnippet = direction.length > 2000
				? direction.slice(0, 2000) + "\n...(truncated)"
				: direction;

			let existingContext = "";
			for (const f of files) {
				const content = await this.app.vault.read(f);
				if (!isNoteEffectivelyEmpty(content)) {
					const snippet = content.length > 1500 ? content.slice(0, 1500) + "\n..." : content;
					existingContext += `\n\n=== ${f.basename} ===\n${snippet}`;
				}
			}
			if (existingContext.length > 12000) {
				existingContext = existingContext.slice(0, 12000) + "\n...(truncated)";
			}

			for (const sub of subtopics) {
				const subName = sanitizeFilename(sub.title);
				const subPath = normalizePath(`${folder.path}/${subName}.md`);

				const existing = this.app.vault.getAbstractFileByPath(subPath);
				if (existing instanceof TFile) {
					const content = await this.app.vault.read(existing);
					if (!isNoteEffectivelyEmpty(content)) {
						logger.info(`Skipping "${subName}" - file already has content`);
						continue;
					}
				}

				const siblingContext = `This note is being added to the folder "${folder.name}" which already has notes on related topics. The user asked to expand with: "${directionSnippet}"\n\nAll notes in this series (existing and new):\n${allNotes}\n\nExisting notes for context:\n${existingContext}\n\nThis specific note should focus on: ${sub.scope}\n\nDo NOT repeat what the existing notes already cover. Add new depth, perspective, and content. Cross-link to both existing and new notes using [[WikiLink]] format.`;

				let subPrompt = mode.prompt
					.replace(/\{selection\}/g, sub.title.replace(/"/g, '\\"'))
					.replace(/\{context\}/g, siblingContext.replace(/"/g, '\\"'))
					+ getOutputRules();

				if (extraInstructions) {
					subPrompt += `\n\nAdditional instructions from the user:\n${extraInstructions}`;
				}

				const relatedLinks = sub.related.map(r => `[[${sanitizeFilename(r)}]]`).join(", ");
				subPrompt += `\n\nIMPORTANT: Link to related notes using [[WikiLink]] format. Related: ${relatedLinks}`;

				this.queue.push({
					type: "topic-note",
					noteName: subName,
					newNotePath: subPath,
					fullPrompt: subPrompt,
					mode,
				});
			}

			const queued = this.queue.length;
			new Notice(`Queued ${queued} new notes to expand "${folder.name}"`);
			this.updateStatusBar();

			if (!this.isProcessing) {
				void this.processQueue();
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Failed to plan expansion notes: ${msg}`, 8000);
			logger.error("Expand folder error: " + msg);
		}
	}

	private async analyzeExistingNote(file: TFile, mode: NoteMode, extraContent: string) {
		const noteContent = await this.app.vault.read(file);
		if (isNoteEffectivelyEmpty(noteContent)) {
			new Notice("This note is empty. Nothing to analyze.");
			return;
		}

		const folderPath = file.parent?.path ?? "";
		const analysisName = sanitizeFilename(`${file.basename} - ${mode.name}`);
		const analysisPath = normalizePath(
			folderPath ? `${folderPath}/${analysisName}.md` : `${analysisName}.md`
		);

		const contentSnippet = noteContent.length > 8000
			? noteContent.slice(0, 8000) + "\n...(truncated)"
			: noteContent;

		let context = contentSnippet;
		if (extraContent) {
			const extraSnippet = extraContent.length > 6000
				? extraContent.slice(0, 6000) + "\n...(truncated)"
				: extraContent;
			context += `\n\n---\n\nADDITIONAL SOURCE MATERIAL PROVIDED BY USER:\n\n${extraSnippet}`;
		}

		let fullPrompt = mode.prompt
			.replace(/\{selection\}/g, file.basename.replace(/"/g, '\\"'))
			.replace(/\{context\}/g, context.replace(/"/g, '\\"'))
			+ getOutputRules();

		this.queue.push({
			type: "topic-note",
			noteName: analysisName,
			newNotePath: analysisPath,
			fullPrompt,
			mode,
		});

		const pos = this.queue.length + (this.isProcessing ? 1 : 0);
		new Notice(`Queued "${analysisName}" - position ${pos}`);
		this.updateStatusBar();

		if (!this.isProcessing) {
			void this.processQueue();
		}
	}

	private async analyzeFolderNotes(folder: TFolder, mode: NoteMode, extraContent: string) {
		const files = folder.children.filter(
			(f): f is TFile => f instanceof TFile && f.extension === "md"
		);

		if (files.length === 0) {
			new Notice("No notes found in this folder.");
			return;
		}

		new Notice(`Reading ${files.length} notes and planning analysis...`);
		logger.info(`Folder analysis: ${files.length} notes, mode=${mode.id}, folder=${folder.path}`);

		let combinedContent = "";
		for (const f of files) {
			const content = await this.app.vault.read(f);
			if (!isNoteEffectivelyEmpty(content)) {
				const snippet = content.length > 3000 ? content.slice(0, 3000) + "\n..." : content;
				combinedContent += `\n\n=== ${f.basename} ===\n${snippet}`;
			}
		}

		if (!combinedContent.trim()) {
			new Notice("All notes in this folder are empty.");
			return;
		}

		const combinedSnippet = combinedContent.length > 15000
			? combinedContent.slice(0, 15000) + "\n...(truncated)"
			: combinedContent;

		const decompositionGuide = mode.folderDecompositionGuide
			? `\n\nDOMAIN-SPECIFIC GUIDANCE:\n${mode.folderDecompositionGuide}`
			: "";

		let extraSection = "";
		if (extraContent) {
			const extraSnippet = extraContent.length > 6000
				? extraContent.slice(0, 6000) + "\n...(truncated)"
				: extraContent;
			extraSection = `\n\nADDITIONAL SOURCE MATERIAL PROVIDED BY USER:\n\n${extraSnippet}`;
		}

		const decompositionPrompt = `You are an expert analyst. You have been given existing notes from a folder and your job is to plan an analysis.

EXISTING NOTES IN THE FOLDER:
${combinedSnippet}${extraSection}

The analysis will be written in the "${mode.name}" style (${mode.description}).${decompositionGuide}

Based on the existing content, plan 3-8 analysis notes. Each note should cover one distinct aspect of the analysis.

Return ONLY valid JSON - no markdown code fences, no explanation, no text before or after. The format:
[
  {"title": "Analysis Note Title", "scope": "2-3 sentence description of what this analysis note covers", "related": ["Other Note Title"], "order": 1}
]

Rules:
- Order notes from most critical to least critical
- Titles should be clear and specific to the content being analyzed
- "scope" should describe the specific analysis angle
- "related" should reference other analysis note titles from your list
- Base your analysis plan on what is ACTUALLY in the existing notes, not generic topics
- Do not create generic analysis - be specific to the content`;

		try {
			const rawResponse = await this.runClaude(decompositionPrompt);

			let subtopics: { title: string; scope: string; related: string[]; order: number }[];
			try {
				const jsonStr = extractJsonArray(rawResponse);
				subtopics = JSON.parse(jsonStr) as typeof subtopics;
			} catch {
				new Notice("Failed to parse analysis plan. Check logs.", 8000);
				logger.error("Folder analysis parse error. Raw: " + rawResponse.slice(0, 500));
				return;
			}

			if (!Array.isArray(subtopics) || subtopics.length === 0) {
				new Notice("No analysis notes planned.", 5000);
				return;
			}

			subtopics.sort((a, b) => (a.order || 0) - (b.order || 0));

			const subtopicList = subtopics
				.map(s => `- [[${sanitizeFilename(s.title)}]]: ${s.scope}`)
				.join("\n");

			for (const sub of subtopics) {
				const subName = sanitizeFilename(sub.title);
				const subPath = normalizePath(`${folder.path}/${subName}.md`);

				const existingSub = this.app.vault.getAbstractFileByPath(subPath);
				if (existingSub instanceof TFile) {
					const content = await this.app.vault.read(existingSub);
					if (!isNoteEffectivelyEmpty(content)) {
						logger.info(`Skipping "${subName}" - already has content`);
						continue;
					}
				}

				const siblingContext = `You are analyzing existing notes in the folder "${folder.name}".\n\nEXISTING NOTES CONTENT:\n${combinedSnippet}${extraSection}\n\nOther analysis notes in this series:\n${subtopicList}\n\nThis specific analysis note should focus on: ${sub.scope}`;

				let subPrompt = mode.prompt
					.replace(/\{selection\}/g, sub.title.replace(/"/g, '\\"'))
					.replace(/\{context\}/g, siblingContext.replace(/"/g, '\\"'))
					+ getOutputRules();

				const relatedLinks = sub.related.map(r => `[[${sanitizeFilename(r)}]]`).join(", ");
				subPrompt += `\n\nLink to related analysis notes: ${relatedLinks}`;

				this.queue.push({
					type: "topic-note",
					noteName: subName,
					newNotePath: subPath,
					fullPrompt: subPrompt,
					mode,
				});
			}

			const total = subtopics.length;
			new Notice(`Queued ${total} analysis notes for "${folder.name}"`);
			this.updateStatusBar();

			if (!this.isProcessing) {
				void this.processQueue();
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Failed to plan analysis: ${msg}`, 8000);
			logger.error("Folder analysis planning error: " + msg);
		}
	}

	private async processQueue() {
		if (this.isProcessing || this.queue.length === 0) return;

		this.isProcessing = true;
		logger.info(`Processing queue: ${this.queue.length} item(s)`);

		while (this.queue.length > 0) {
			const item = this.queue.shift()!;
			this.processingItem = item;
			this.streamData = { currentOutput: "", startTime: Date.now() };
			this.updateStatusBar();

			const label = item.type === "note" || item.type === "topic-note"
				? item.noteName
				: item.type === "append" ? `${item.mode.name} on ${item.fileName}` : item.action.name;
			logger.info(`Processing item: type=${item.type}, label="${label}"`);

			try {
				let content = await this.runClaude(item.fullPrompt);
				content = fixCodeBlocks(content);
				content = fixMermaidBlocks(content);
				content = fixDetailsBlocks(content);
				content = fixCalloutCodeFences(content);
				content = fixDataviewInlineQueries(content);
				content = fixCurrencyDollars(content);

				const elapsed = Date.now() - this.streamData.startTime;

				if (item.type === "note" || item.type === "topic-note") {
					const fmStart = content.indexOf("---");
					if (fmStart > 0) {
						content = content.slice(fmStart);
					}
					const existing = this.app.vault.getAbstractFileByPath(item.newNotePath);
					if (existing instanceof TFile) {
						const current = await this.app.vault.read(existing);
						if (isNoteEffectivelyEmpty(current)) {
							await this.app.vault.modify(existing, content);
							new Notice(`Filled note: ${item.noteName} (${this.queue.length} remaining)`);
						} else {
							new Notice(`"${item.noteName}" already has content, skipped.`);
						}
					} else {
						await this.app.vault.create(item.newNotePath, content);
						new Notice(`Created: ${item.noteName} (${this.queue.length} remaining)`);
					}
					if (item.type === "note") {
						this.applyLinkReplacement(item.linkReplacement);
					}
					if (item.type === "topic-note" && item.renameFromContent) {
						const h1 = content.match(/^#\s+(.+)$/m);
						if (h1) {
							const betterName = sanitizeFilename(h1[1].trim());
							if (betterName && betterName !== item.noteName) {
								const dir = item.newNotePath.replace(/[^/]+$/, "");
								const betterPath = normalizePath(`${dir}${betterName}.md`);
								if (!this.app.vault.getAbstractFileByPath(betterPath)) {
									const created = this.app.vault.getAbstractFileByPath(item.newNotePath);
									if (created instanceof TFile) {
										await this.app.fileManager.renameFile(created, betterPath);
										item.noteName = betterName;
										item.newNotePath = betterPath;
									}
								}
							}
						}
					}
					this.completedItems.push({ item, chars: content.length, elapsed, timestamp: Date.now() });
				} else if (item.type === "append") {
					const file = this.app.vault.getAbstractFileByPath(item.filePath);
					if (file instanceof TFile) {
						const existing = await this.app.vault.read(file);
						await this.app.vault.modify(file, existing + "\n\n" + content);
						new Notice(`Appended ${item.mode.name} to ${item.fileName} (${this.queue.length} remaining)`);
						this.completedItems.push({ item, chars: content.length, elapsed, timestamp: Date.now() });
					} else {
						new Notice(`File not found: ${item.filePath}`, 5000);
					}
				} else if (item.type === "inline") {
					if (item.insertionMode === "replace") {
						item.editor.replaceRange(content, item.from, item.to);
						new Notice(`Replaced selection with ${item.action.name} result (${this.queue.length} remaining)`);
					} else {
						item.editor.replaceRange("\n\n" + content, item.to, item.to);
						new Notice(`Inserted ${item.action.name} result below selection (${this.queue.length} remaining)`);
					}
					this.completedItems.push({ item, chars: content.length, elapsed, timestamp: Date.now() });
				}
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				const errLabel = this.getItemLabel(item);
				logger.error(`Task failed: "${errLabel}" - ${msg}`);
				this.failedItems.push({ item, error: msg, timestamp: Date.now() });
				new Notice(`Failed: ${errLabel} - ${msg}. Use queue viewer to retry.`, 8000);
			}
		}

		this.processingItem = null;
		this.streamData = { currentOutput: "", startTime: 0 };
		this.isProcessing = false;
		this.updateStatusBar();
		new Notice("All queued tasks completed.");
	}

	private runClaude(prompt: string): Promise<string> {
		if (this.settings.aiProvider === "ollama") {
			return this.runOllama(prompt);
		}

		return new Promise((resolve, reject) => {
			const systemPrompt = "Output ONLY the note content as markdown text directly to stdout. Write from your training knowledge. You CAN use web search if needed. Do not ask questions. Do not offer alternatives. Do not attempt to save or write files. Just output the note content directly as your response.";

			let execPath: string;
			let args: string[];
			let stdinPayload = prompt;
			let codexOutputPath: string | null = null;

			if (this.settings.aiProvider === "gemini") {
				execPath = this.settings.geminiPath;
				args = [
					"-p", systemPrompt,
					"--approval-mode", "plan",
				];
				if (this.settings.geminiModel) {
					args.push("--model", this.settings.geminiModel);
				}
			} else if (this.settings.aiProvider === "codex") {
				execPath = this.settings.codexPath;
				// Codex has no system prompt flag in exec mode; prepend it to the stdin prompt.
				// Its stdout interleaves progress logs with output, so the final message is
				// captured via --output-last-message, written inside the plugin's own config
				// folder so it can be read back through the vault adapter.
				codexOutputPath = normalizePath(
					`${this.app.vault.configDir}/plugins/${this.manifest.id}/codex-last-message-${Date.now()}.md`
				);
				args = [
					"exec",
					"--sandbox", "read-only",
					"--skip-git-repo-check",
				];
				const adapter = this.app.vault.adapter;
				if (adapter instanceof FileSystemAdapter) {
					args.push("--output-last-message", adapter.getFullPath(codexOutputPath));
				} else {
					codexOutputPath = null;
				}
				if (this.settings.codexModel) {
					args.push("--model", this.settings.codexModel);
				}
				args.push("-");
				stdinPayload = systemPrompt + "\n\n" + prompt;
			} else {
				execPath = this.settings.claudePath;
				args = [
					"-p", systemPrompt,
					"--max-turns", "10",
					"--disallowedTools", "Edit,Write,Read,Bash,PowerShell,Glob,Grep",
				];
				if (this.settings.modelFlag) {
					args.push("--model", this.settings.modelFlag);
				}
			}

			const providerLabel = PROVIDER_LABELS[this.settings.aiProvider];
			logger.info(`Spawning [${providerLabel}]: ${execPath} ${args.map(a => a.length > 40 ? a.slice(0, 40) + "..." : a).join(" ")}`);
			logger.info(`Stdin prompt length: ${prompt.length} chars`);

			const proc = spawnCli(execPath, args, {
				shell: true,
				windowsHide: true,
			});

			let stdout = "";
			let stderr = "";

			proc.stdout.on("data", (data) => {
				const chunk = data.toString();
				stdout += chunk;
				this.streamData.currentOutput = stdout;
			});
			proc.stderr.on("data", (data) => { stderr += data.toString(); });

			const cliNotFoundError = () => new Error(
				`${providerLabel} CLI not found (looked for "${execPath}"). Install it, or set its full path in Settings -> Second Brain Builder. See the README's Troubleshooting section for PATH fixes.`
			);

			proc.on("close", (code: number) => {
				logger.info(`Process exited with code ${code}, stdout: ${stdout.length} chars, stderr: ${stderr.length} chars`);
				if (code !== 0) {
					const errorDetail = stderr || stdout || `Process exited with code ${code}`;
					logger.error(`Exit code ${code}. Stderr: ${stderr.slice(0, 500)}`);
					logger.error(`Exit code ${code}. Stdout: ${stdout.slice(0, 500)}`);
					const cliMissing = code === 127 || code === 9009 ||
						/is not recognized as an internal or external command|command not found|No such file or directory/i.test(errorDetail);
					reject(cliMissing ? cliNotFoundError() : new Error(errorDetail.trim()));
				} else {
					void (async () => {
						let result = stdout.trim();
						if (codexOutputPath) {
							try {
								const lastMessage = (await this.app.vault.adapter.read(codexOutputPath)).trim();
								if (lastMessage) result = lastMessage;
							} catch { /* fall back to stdout */ }
							try { await this.app.vault.adapter.remove(codexOutputPath); } catch { /* ignore */ }
						}
						logger.info(`${providerLabel} responded successfully`);
						resolve(result);
					})();
				}
			});

			proc.on("error", (err) => {
				logger.error(`Spawn error: ${err.message}`);
				reject(err.code === "ENOENT" ? cliNotFoundError() : err);
			});

			proc.stdin.write(stdinPayload);
			proc.stdin.end();
		});
	}

	private async runOllama(prompt: string): Promise<string> {
		const systemPrompt = "Output ONLY the note content as markdown text directly. Write from your training knowledge. Do not ask questions. Do not offer alternatives. Just output the note content directly as your response.";
		const url = `${this.settings.ollamaUrl}/api/generate`;
		const body = JSON.stringify({
			model: this.settings.ollamaModel,
			prompt,
			system: systemPrompt,
			stream: false,
		});

		logger.info(`Ollama request: ${url}, model=${this.settings.ollamaModel}, prompt=${prompt.length} chars`);

		let response: RequestUrlResponse;
		try {
			response = await requestUrl({
				url,
				method: "POST",
				contentType: "application/json",
				body,
				throw: false,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`Ollama connection failed: ${msg}. Is Ollama running at ${this.settings.ollamaUrl}?`);
		}

		if (response.status >= 400) {
			throw new Error(`Ollama error (${response.status}): ${response.text}`);
		}

		const json = response.json as { error?: string; response?: string };
		if (json.error) {
			throw new Error(`Ollama: ${json.error}`);
		}

		const output = (json.response ?? "").trim();
		this.streamData.currentOutput = output;
		logger.info(`Ollama responded successfully, ${output.length} chars`);
		return output;
	}
}
