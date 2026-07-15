import { App, PluginSettingTab, Setting } from "obsidian";
import BUILTIN_MODES from "../modes.json";
import { AIProvider, NoteMode } from "./types";
import { INLINE_ACTIONS } from "./inline-actions";
import { logger } from "./logger";
import type ClaudeExplainerPlugin from "./main";

// ─── Settings Tab ────────────────────────────────────────────────

export class ClaudeExplainerSettingTab extends PluginSettingTab {
	plugin: ClaudeExplainerPlugin;

	constructor(app: App, plugin: ClaudeExplainerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private renderSetupGuide(containerEl: HTMLElement, heading: string, steps: { title: string; text: string }[]): void {
		new Setting(containerEl).setName(heading).setHeading();
		const guideEl = containerEl.createDiv({ cls: "ch-guide" });
		for (const step of steps) {
			const stepEl = guideEl.createDiv({ cls: "ch-guide-step" });
			if (step.title) {
				stepEl.createEl("strong", { cls: "ch-strong-block ch-gap-above", text: step.title });
				stepEl.createSpan({ text: step.text });
			} else {
				stepEl.createEl("code", { cls: "ch-guide-code", text: step.text });
			}
		}
	}

	private cliTestStep(cli: string): { title: string; text: string } {
		return {
			title: "4. Test",
			text: `Select text in any note and run "Explain selection with AI" from the command palette. If the plugin reports the CLI is not found, enter its full path above (find it with "where ${cli}" on Windows or "which ${cli}" on macOS/Linux).`,
		};
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("AI provider")
			.setDesc("Which AI backend to use for generating notes.")
			.addDropdown((dropdown) => {
				dropdown.addOption("claude", "Claude");
				dropdown.addOption("gemini", "Gemini");
				dropdown.addOption("codex", "Codex");
				dropdown.addOption("ollama", "Ollama (local)");
				dropdown.setValue(this.plugin.settings.aiProvider);
				dropdown.onChange(async (value) => {
					this.plugin.settings.aiProvider = value as AIProvider;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.plugin.settings.aiProvider === "claude") {
			new Setting(containerEl)
				.setName("Claude CLI path")
				.setDesc("Path to the Claude Code CLI executable.")
				.addText((text) =>
					text
						.setPlaceholder("claude")
						.setValue(this.plugin.settings.claudePath)
						.onChange(async (value) => {
							this.plugin.settings.claudePath = value || "claude";
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Claude model")
				.setDesc("Optional model override (e.g. claude-sonnet-4-6). Leave empty for default.")
				.addText((text) =>
					text
						.setPlaceholder("")
						.setValue(this.plugin.settings.modelFlag)
						.onChange(async (value) => {
							this.plugin.settings.modelFlag = value.trim();
							await this.plugin.saveSettings();
						})
				);

			this.renderSetupGuide(containerEl, "Claude Code setup guide", [
				{ title: "1. Install Node.js", text: "Download version 16 or newer from nodejs.org. Verify in a terminal with: node --version" },
				{ title: "2. Install the Claude Code CLI", text: "In a terminal, run:" },
				{ title: "", text: "npm install -g @anthropic-ai/claude-code" },
				{ title: "3. Log in", text: "Run claude once in a terminal and follow the login prompts. Requires a Claude account (Pro, Max, or API billing)." },
				this.cliTestStep("claude"),
			]);
		} else if (this.plugin.settings.aiProvider === "gemini") {
			new Setting(containerEl)
				.setName("Gemini CLI path")
				.setDesc("Path to the Gemini CLI executable.")
				.addText((text) =>
					text
						.setPlaceholder("gemini")
						.setValue(this.plugin.settings.geminiPath)
						.onChange(async (value) => {
							this.plugin.settings.geminiPath = value || "gemini";
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Gemini model")
				.setDesc("Optional model override (e.g. gemini-2.5-pro). Leave empty for default.")
				.addText((text) =>
					text
						.setPlaceholder("")
						.setValue(this.plugin.settings.geminiModel)
						.onChange(async (value) => {
							this.plugin.settings.geminiModel = value.trim();
							await this.plugin.saveSettings();
						})
				);

			this.renderSetupGuide(containerEl, "Gemini CLI setup guide", [
				{ title: "1. Install Node.js", text: "Download version 16 or newer from nodejs.org. Verify in a terminal with: node --version" },
				{ title: "2. Install the Gemini CLI", text: "In a terminal, run:" },
				{ title: "", text: "npm install -g @google/gemini-cli" },
				{ title: "3. Log in", text: "Run gemini once in a terminal and sign in with your Google account. The free tier is enough to start." },
				this.cliTestStep("gemini"),
			]);
		} else if (this.plugin.settings.aiProvider === "codex") {
			new Setting(containerEl)
				.setName("Codex CLI path")
				.setDesc("Path to the OpenAI Codex CLI executable.")
				.addText((text) =>
					text
						.setPlaceholder("codex")
						.setValue(this.plugin.settings.codexPath)
						.onChange(async (value) => {
							this.plugin.settings.codexPath = value || "codex";
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Codex model")
				.setDesc("Optional model override (e.g. gpt-5.1-codex). Leave empty for default.")
				.addText((text) =>
					text
						.setPlaceholder("")
						.setValue(this.plugin.settings.codexModel)
						.onChange(async (value) => {
							this.plugin.settings.codexModel = value.trim();
							await this.plugin.saveSettings();
						})
				);

			this.renderSetupGuide(containerEl, "Codex CLI setup guide", [
				{ title: "1. Install Node.js", text: "Download version 16 or newer from nodejs.org. Verify in a terminal with: node --version" },
				{ title: "2. Install the Codex CLI", text: "In a terminal, run:" },
				{ title: "", text: "npm install -g @openai/codex" },
				{ title: "3. Log in", text: "Run codex once in a terminal and sign in with your OpenAI or ChatGPT account." },
				this.cliTestStep("codex"),
			]);
		} else if (this.plugin.settings.aiProvider === "ollama") {
			new Setting(containerEl)
				.setName("Ollama server URL")
				.setDesc("Base URL of the Ollama API server.")
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:11434")
						.setValue(this.plugin.settings.ollamaUrl)
						.onChange(async (value) => {
							this.plugin.settings.ollamaUrl = value || "http://localhost:11434";
							await this.plugin.saveSettings();
						})
				);

			const ollamaModels: { value: string; label: string; desc: string }[] = [
				{ value: "qwen3.5:latest", label: "Qwen 3.5 (6.6 GB)", desc: "Fast general-purpose model. Best for quick explanations, summaries, and everyday note generation. Good balance of speed and quality." },
				{ value: "gemma4:e4b", label: "Gemma 4 E4B (9.6 GB)", desc: "Strong reasoning and instruction following. Best for detailed technical notes, code walkthroughs, and structured content that needs precise formatting." },
				{ value: "gpt-oss:20b", label: "GPT-OSS 20B (13 GB)", desc: "Largest and most capable. Best for complex topics requiring deep analysis, multi-step reasoning, and comprehensive coverage." },
			];

			const currentModel = this.plugin.settings.ollamaModel;
			const isPreset = ollamaModels.some(m => m.value === currentModel);

			new Setting(containerEl)
				.setName("Ollama model")
				.setDesc("Select a recommended model or enter a custom one. Models must be pulled first with 'ollama pull <model>'.")
				.addDropdown((dropdown) => {
					for (const m of ollamaModels) {
						dropdown.addOption(m.value, m.label);
					}
					dropdown.addOption("__custom__", "Custom model...");
					dropdown.setValue(isPreset ? currentModel : "__custom__");
					dropdown.onChange(async (value) => {
						if (value === "__custom__") {
							this.plugin.settings.ollamaModel = currentModel;
						} else {
							this.plugin.settings.ollamaModel = value;
						}
						await this.plugin.saveSettings();
						this.display();
					});
				});

			if (!isPreset) {
				new Setting(containerEl)
					.setName("Custom model name")
					.setDesc("Enter any model available in your Ollama installation.")
					.addText((text) =>
						text
							.setPlaceholder("llama3")
							.setValue(this.plugin.settings.ollamaModel)
							.onChange(async (value) => {
								this.plugin.settings.ollamaModel = value.trim() || "llama3";
								await this.plugin.saveSettings();
							})
					);
			}

			// Model recommendation card
			const activeModel = ollamaModels.find(m => m.value === this.plugin.settings.ollamaModel);
			if (activeModel) {
				const recEl = containerEl.createDiv({ cls: "setting-item ch-rec-card" });
				recEl.createEl("strong", { cls: "ch-strong-block ch-gap-below", text: activeModel.label });
				recEl.createSpan({ cls: "ch-muted-note", text: activeModel.desc });
			}

			// Model comparison table
			new Setting(containerEl).setName("Model comparison").setHeading();
			const table = containerEl.createEl("table", { cls: "ch-settings-table" });
			const thead = table.createEl("thead");
			const headerRow = thead.createEl("tr");
			for (const h of ["Model", "Size", "Speed", "Best for"]) {
				headerRow.createEl("th", { text: h });
			}
			const tbody = table.createEl("tbody");
			const rows = [
				["Qwen 3.5", "6.6 GB", "Fastest", "Quick notes, summaries, everyday use"],
				["Gemma 4 E4B", "9.6 GB", "Medium", "Technical docs, code analysis, structured output"],
				["GPT-OSS 20B", "13 GB", "Slowest", "Deep analysis, complex reasoning, research notes"],
			];
			for (const row of rows) {
				const tr = tbody.createEl("tr");
				for (const cell of row) {
					tr.createEl("td", { text: cell });
				}
			}

			// Ollama setup guide
			this.renderSetupGuide(containerEl, "Ollama setup guide", [
				{ title: "1. Install Ollama", text: "Download and install from ollama.com. Available for Windows, macOS, and Linux." },
				{ title: "2. Start the server", text: "Open a terminal and run: ollama serve. This starts the API server on localhost:11434. Keep the terminal open while using the plugin." },
				{ title: "3. Pull a model", text: "In a separate terminal, pull the model you want to use:" },
				{ title: "", text: "ollama pull qwen3.5:latest" },
				{ title: "", text: "ollama pull gemma4:e4b" },
				{ title: "", text: "ollama pull gpt-oss:20b" },
				{ title: "4. Verify", text: "Run: ollama list to confirm your models are downloaded. Then select a model above and generate a note to test." },
			]);

			// Platform-specific notes
			new Setting(containerEl).setName("Platform notes").setHeading();
			const platformEl = containerEl.createDiv({ cls: "ch-guide" });

			const platforms = [
				{
					name: "Windows",
					notes: [
						"Install the .exe from ollama.com/download/windows.",
						"Ollama runs as a background service after installation. Check the system tray for the Ollama icon.",
						"If the tray icon is present, the server is already running. Skip 'ollama serve' and go straight to pulling models.",
						"Models are stored in C:\\Users\\<you>\\.ollama\\models.",
					],
				},
				{
					name: "macOS",
					notes: [
						"Install via the .dmg from ollama.com/download/mac, or with Homebrew: brew install ollama.",
						"The Ollama app runs as a menu bar icon and starts the server automatically.",
						"If you installed via Homebrew, start the server manually: ollama serve.",
						"Models are stored in ~/.ollama/models.",
						"Apple Silicon (M1/M2/M3/M4) Macs run models significantly faster than Intel Macs thanks to the unified GPU memory.",
					],
				},
				{
					name: "Linux",
					notes: [
						"Install with the one-liner: curl -fsSL https://ollama.com/install.sh | sh",
						"This installs Ollama and sets up a systemd service that starts automatically.",
						"Check the service status: systemctl status ollama.",
						"If not using systemd, start manually: ollama serve.",
						"Models are stored in ~/.ollama/models (or /usr/share/ollama/.ollama/models if running as the ollama user).",
						"For GPU acceleration, install NVIDIA CUDA drivers or AMD ROCm. Ollama auto-detects available GPUs.",
					],
				},
			];

			for (const platform of platforms) {
				const pEl = platformEl.createDiv({ cls: "ch-platform-card" });
				pEl.createEl("strong", { cls: "ch-strong-block ch-gap-below", text: platform.name });
				const ul = pEl.createEl("ul");
				for (const note of platform.notes) {
					ul.createEl("li", { text: note });
				}
			}
		}

		new Setting(containerEl)
			.setName("Enable logging")
			.setDesc("Log CLI invocations, errors, and timing to an in-memory buffer. View with the 'View logs' command.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableLogging)
					.onChange(async (value) => {
						this.plugin.settings.enableLogging = value;
						logger.setEnabled(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Preferred mode")
			.setDesc("Pre-selected mode when no previous mode has been used. Leave empty to start with no selection. The modal remembers your last used mode automatically.")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "(None)");
				const standardModes = this.plugin.getStandardModes();
				for (const mode of standardModes) {
					dropdown.addOption(mode.id, mode.name);
				}
				dropdown.setValue(this.plugin.settings.defaultModeId);
				dropdown.onChange(async (value) => {
					this.plugin.settings.defaultModeId = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName("Built-in note modes").setHeading();
		containerEl.createEl("p", {
			cls: "ch-muted-note",
			text: (BUILTIN_MODES as NoteMode[]).map(m => m.name).join(", "),
		});

		new Setting(containerEl).setName("Inline actions").setHeading();
		containerEl.createEl("p", {
			cls: "ch-muted-note",
			text: INLINE_ACTIONS.map(a => a.name).join(", "),
		});

		new Setting(containerEl).setName("Custom modes").setHeading();
		containerEl.createEl("p", {
			text: "Add your own modes. Each mode needs an ID, name, description, and prompt template. Use {selection} and {context} as placeholders in your prompt.",
			cls: "setting-item-description",
		});

		for (let i = 0; i < this.plugin.settings.customModes.length; i++) {
			const mode = this.plugin.settings.customModes[i];
			const modeContainer = containerEl.createDiv({ cls: "ch-custom-mode" });

			new Setting(modeContainer)
				.setName("Mode name")
				.addText((text) =>
					text.setValue(mode.name).onChange(async (value) => {
						mode.name = value;
						mode.id = value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
						await this.plugin.saveSettings();
					})
				);

			new Setting(modeContainer)
				.setName("Description")
				.addText((text) =>
					text.setValue(mode.description).onChange(async (value) => {
						mode.description = value;
						await this.plugin.saveSettings();
					})
				);

			new Setting(modeContainer)
				.setName("Prompt")
				.addTextArea((text) => {
					text.setValue(mode.prompt).onChange(async (value) => {
						mode.prompt = value;
						await this.plugin.saveSettings();
					});
					text.inputEl.rows = 6;
					text.inputEl.addClass("ch-full-width-input");
				});

			new Setting(modeContainer)
				.addButton((btn) =>
					btn.setButtonText("Remove").setWarning().onClick(async () => {
						this.plugin.settings.customModes.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);
		}

		new Setting(containerEl)
			.addButton((btn) =>
				btn.setButtonText("Add custom mode").onClick(async () => {
					this.plugin.settings.customModes.push({
						id: "custom-" + Date.now(),
						name: "New Mode",
						icon: "pencil",
						description: "My custom mode",
						prompt: 'The user selected "{selection}" while reading:\n\n---\n{context}\n---\n\nWrite detailed notes about "{selection}".',
					});
					await this.plugin.saveSettings();
					this.display();
				})
			);
	}
}
