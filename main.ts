import { Editor, EditorPosition, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, App, Setting, TFile, TFolder, normalizePath, Menu, setIcon } from "obsidian";
import { spawn } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import BUILTIN_MODES from "./modes.json";

interface NoteMode {
	id: string;
	name: string;
	icon: string;
	description: string;
	prompt: string;
	isDefault?: boolean;
	fullNote?: boolean;
	folderDecompositionGuide?: string;
	analyzesExisting?: boolean;
}

interface InlineAction {
	id: string;
	name: string;
	icon: string;
	description: string;
	prompt: string;
}

interface NoteConfig {
	mode: NoteMode;
	title: string;
	extraInstructions: string;
}

interface InlineActionConfig {
	action: InlineAction;
	insertionMode: "replace" | "below";
	extraInstructions: string;
}

interface PendingLinkReplacement {
	editor: Editor;
	from: EditorPosition;
	to: EditorPosition;
	selection: string;
	linksText: string;
	applied: boolean;
}

interface NoteQueueItem {
	type: "note";
	selection: string;
	noteName: string;
	newNotePath: string;
	fullPrompt: string;
	mode: NoteMode;
	editor: Editor;
	linkReplacement?: PendingLinkReplacement;
}

interface InlineQueueItem {
	type: "inline";
	selection: string;
	fullPrompt: string;
	action: InlineAction;
	editor: Editor;
	from: EditorPosition;
	to: EditorPosition;
	insertionMode: "replace" | "below";
}

interface AppendQueueItem {
	type: "append";
	filePath: string;
	fileName: string;
	fullPrompt: string;
	mode: NoteMode;
}

interface TopicNoteQueueItem {
	type: "topic-note";
	noteName: string;
	newNotePath: string;
	fullPrompt: string;
	mode: NoteMode;
	renameFromContent?: boolean;
}

type QueueItem = NoteQueueItem | InlineQueueItem | AppendQueueItem | TopicNoteQueueItem;

const INLINE_ACTIONS: InlineAction[] = [
	{
		id: "expand",
		name: "Expand",
		icon: "maximize-2",
		description: "Add more depth, details, and sub-points",
		prompt: `You are an expert writer enhancing notes in an Obsidian vault. Expand the selected text with more depth, details, sub-points, and elaboration.

The user selected the following text:

---
{selection}
---

From this note:

---
{context}
---

Expand the selected text with significantly more detail. Add deeper explanations of each point, additional sub-points and nuances, supporting evidence or reasoning, and concrete examples where helpful. Keep the same tone, structure, and formatting style as the original. Output the expanded version that replaces the original selection.`
	},
	{
		id: "simplify",
		name: "Simplify",
		icon: "minimize-2",
		description: "Rewrite to be clearer and more concise",
		prompt: `You are an expert editor who simplifies text while preserving meaning.

The user selected the following text:

---
{selection}
---

From this note:

---
{context}
---

Simplify the selected text: use simpler words and shorter sentences, remove unnecessary jargon (or define it if essential), keep the core meaning intact, maintain the same formatting style, and cut redundancy. Output only the simplified replacement text.`
	},
	{
		id: "add-examples",
		name: "Add Examples",
		icon: "list-plus",
		description: "Insert practical examples after the selection",
		prompt: `You are a teaching assistant that creates clear, practical examples.

The user selected the following text:

---
{selection}
---

From this note:

---
{context}
---

Create 2-4 practical, concrete examples that illustrate the key concepts in the selection. For each example, give it a descriptive title, walk through it concretely, and use code blocks, diagrams, or math notation as appropriate. Match the formatting style of the surrounding note.`
	},
	{
		id: "add-diagram",
		name: "Add Diagram",
		icon: "git-branch",
		description: "Generate a mermaid diagram for the content",
		prompt: `You are a visual thinking assistant. Create a mermaid diagram that best represents the selected content.

The user selected the following text:

---
{selection}
---

From this note:

---
{context}
---

Choose the most appropriate mermaid diagram type (flowchart, graph, sequenceDiagram, classDiagram, mindmap, timeline, etc.) and generate it.

IMPORTANT mermaid syntax rules: always wrap node labels and subgraph titles in double quotes. Use plain hyphens (-) instead of em dashes. Keep syntax strictly ASCII-safe. No special characters outside quoted labels. Never use markdown list syntax inside labels (no "- item", "* item", "1. step", or "1) step"); for numbered steps in edge labels use a colon "1:" not "1." to avoid "Unsupported markdown: list" errors.

Output only the mermaid code block.`
	},
	{
		id: "summarize",
		name: "Summarize",
		icon: "align-left",
		description: "Condense into a brief summary",
		prompt: `You are an expert at distilling information into concise summaries.

The user selected the following text:

---
{selection}
---

From this note:

---
{context}
---

Write a concise summary (2-5 sentences) that captures all key points, preserves the most important details, and uses clear direct language. Output only the summary text.`
	},
	{
		id: "challenge",
		name: "Challenge",
		icon: "help-circle",
		description: "Generate critical questions and counterarguments",
		prompt: `You are a critical thinking coach. Generate probing questions and counterarguments about the selected content.

The user selected the following text:

---
{selection}
---

From this note:

---
{context}
---

Generate a section with:

**Critical Questions**
3-5 probing questions that test assumptions, identify gaps, or push for deeper understanding.

**Counterarguments**
2-3 alternative perspectives or objections to the claims made.

**What's Missing?**
Key aspects or viewpoints not addressed in the selection.

Keep it constructive - the goal is to strengthen understanding.`
	},
	{
		id: "fix-polish",
		name: "Fix & Polish",
		icon: "wand",
		description: "Fix grammar, improve structure and clarity",
		prompt: `You are a professional editor. Fix and polish the selected text while preserving its meaning exactly.

The user selected the following text:

---
{selection}
---

From this note:

---
{context}
---

Polish the selected text: fix grammar, spelling, and punctuation; improve sentence structure and flow; enhance clarity and readability; improve markdown formatting where appropriate. Keep the meaning, tone, and level of detail identical. Do not add new content or remove existing points. Output only the polished replacement text.`
	},
	{
		id: "eli5-inline",
		name: "ELI5",
		icon: "smile",
		description: "Rewrite as a simple, jargon-free explanation",
		prompt: `You are an expert who explains things to complete beginners using the simplest possible language.

The user selected the following text:

---
{selection}
---

From this note:

---
{context}
---

Rewrite the selection as if explaining to someone with no background in this topic. Use everyday language and short sentences, replace every technical term with a simple explanation, add an analogy if it helps, and keep it roughly the same length or shorter. Output only the simplified replacement text.`
	},
	{
		id: "to-code",
		name: "Translate to Code",
		icon: "code",
		description: "Convert the concept into code examples",
		prompt: `You are a developer who translates concepts into clean, working code.

The user selected the following text:

---
{selection}
---

From this note:

---
{context}
---

Create code examples that implement or demonstrate the concepts described. Use Python unless the context clearly suggests another language. Include 1-3 code blocks, each demonstrating a different aspect. Add brief comments explaining key lines. Make the code runnable and self-contained. Show expected output where relevant. Format as a section with brief prose connecting the examples.`
	},
];

function getOutputRules(): string {
	const today = new Date().toISOString().slice(0, 10);
	return `

Formatting rules:
- The VERY FIRST characters of your output must be --- (the YAML frontmatter opening). No blank lines, no text, no whitespace before it. Output frontmatter in this exact format:
  ---
  tags: [tag1, tag2, tag3, ...]
  status: Seed
  updated: ${today}
  ---
  Generate 4-8 lowercase, hyphenated tags relevant to the topic and mode. Always include the broad domain (e.g. engineering, cs, math, dsa). Use today's date (${today}) for "updated".
- After the frontmatter closing ---, add a blank line, then a level-1 heading with the note title (e.g. # Topic Name).
- Write in markdown.
- Never use em dashes. Use commas, periods, colons, or semicolons instead. Write "to" instead of a range dash where possible.
- Write in plain, clear language. Prefer short sentences. Avoid jargon unless defining it. The reader should never have to re-read a sentence to understand it.
- Escape dollar signs used for currency with a backslash: write \\$1M not $1M, \\$500k not $500k, \\$1,000 not $1,000. Unescaped $ is interpreted as LaTeX and will corrupt surrounding text.
- Break up dense text into short paragraphs (2-4 sentences max per paragraph). Add a blank line between paragraphs.
- After each heading, start with a brief orienting sentence before diving into details.
- Use bullet points for lists, but follow each bullet with a full sentence, not just a keyword.
- Use mermaid code blocks for complex diagrams, flowcharts, architecture, processes, hierarchies, or relationships. IMPORTANT mermaid syntax rules:
  1. Each statement MUST be on its own line with a real line break. Never compress an entire diagram onto one line.
  2. For multi-line text INSIDE a single node label, use <br/> as the line break character (e.g. A["Line one<br/>Line two"]).
  3. Never use literal backslash-n characters inside mermaid blocks. Use <br/> for line breaks within labels.
  4. Always wrap node labels in double quotes inside their shape delimiters: A["Load Balancer"], B["Database"], C("Rounded"), D{"Decision"}. This is critical when labels contain parentheses, slashes, or other special characters (e.g. A["System (Restart/Scale)"], NOT A[System (Restart/Scale)]).
  5. Always wrap subgraph titles in double quotes: subgraph "Data Plane".
  6. Close every subgraph with 'end' on its own line.
  7. Use plain hyphens (-) instead of em dashes. Keep mermaid syntax strictly ASCII-safe.
  8. Never use special characters like em dashes, curly quotes, or unicode symbols outside of quoted labels.
  9. Put edge labels in double quotes with pipes: -->|"label"|.
  10. "end" is a reserved keyword in mermaid (closes subgraphs). Never use "end" as a node ID or as part of a node ID. Use alternatives like "finish", "done", "complete", or prefix it: "endNode", "processEnd". Also avoid words containing "end" as a substring in node labels or edge labels (e.g. "Send", "Backend", "Append", "endpoint"). Use synonyms: "Transmit" instead of "Send", "Server" instead of "Backend", "Add" instead of "Append".
  11. Never use markdown list syntax inside node or edge labels. Mermaid does not support markdown lists in labels and will show "Unsupported markdown: list". This includes unordered lists ("- item", "* item") AND numbered lists ("1. Step one", "1) Step one"). For numbered steps in edge labels, use a colon: -->|"1: Serialize"| not -->|"1. Serialize"|. For lists inside node labels, use <br/> to separate items.
- Use tables for comparisons or structured data.
- Use code blocks with language tags for code or config.
- Use Title Case for all headings and subheadings (e.g. "How It Works", "Key Properties and Theorems").
- Do not wrap the entire output in a markdown code fence.
- For collapsible/expandable content (hints, progressive reveals, spoilers), use Obsidian collapsible callouts instead of HTML <details> tags. Format: \`> [!tip]- Title\` (the \`-\` makes it collapsed by default). EVERY line inside a callout MUST start with \`> \`, including blank lines (\`>\`), code block content, AND the closing \`\`\` fence. Missing \`> \` on ANY line (especially the closing \`\`\`) breaks the entire callout rendering. Example:
  > [!tip]- Click to reveal
  >
  > \`\`\`python
  > def example():
  >     return True
  > \`\`\`
  >
  > More text after code.
- Do NOT use HTML <details> or <summary> tags. They break code rendering in Obsidian.
- Your output will be saved directly into an Obsidian note. Do not ask the user questions, do not add sign-off lines, do not offer to save the file, do not include any conversational text. Output only the note content.`;
}

const INLINE_OUTPUT_RULES = `

Output rules:
- Output ONLY the content to be inserted or used as replacement. No preamble, no sign-off, no explanation of what you did.
- Never use em dashes. Use commas, periods, colons, or semicolons instead.
- Write in plain, clear language. Prefer short sentences. Break up dense text with blank lines between paragraphs (2-4 sentences max per paragraph).
- Escape dollar signs used for currency: \\$1M not $1M, \\$500k not $500k. Unescaped $ is LaTeX.
- Match the formatting style (heading levels, list style, indentation) of the surrounding note.
- Write in markdown.
- Use mermaid code blocks for diagrams. Each statement on its own line. Use <br/> for line breaks within node labels (never literal backslash-n). Always wrap labels in double quotes inside shape delimiters: A["Label"], B("Rounded"), C{"Decision"}. Quoting is critical when labels contain parentheses or slashes (e.g. A["System (Restart/Scale)"]). Wrap subgraph titles in quotes. Close each subgraph with 'end'. Never use "end" as a node ID (it is reserved). Avoid words containing "end" as a substring in labels (Send, Backend, Append, endpoint); use synonyms instead. ASCII-safe only, no em dashes. Never use markdown list syntax inside labels (no "- item", "* item", "1. step", or "1) step"); for numbered steps in edge labels use a colon "1:" not "1." to avoid "Unsupported markdown: list" errors.
- For collapsible content use Obsidian callouts: \`> [!tip]- Title\`. EVERY line inside (including closing \`\`\`) MUST start with \`> \`. Do NOT use HTML <details> tags.
- Do not wrap the entire output in a markdown code fence.
- Do not include any conversational text.`;

const APPEND_OUTPUT_RULES = `

Formatting rules:
- Do NOT include YAML frontmatter or a title heading. This content will be appended to an existing note.
- Write in markdown.
- Never use em dashes. Use commas, periods, colons, or semicolons instead. Write "to" instead of a range dash where possible.
- Write in plain, clear language. Prefer short sentences. Avoid jargon unless defining it.
- Escape dollar signs used for currency: \\$1M not $1M, \\$500k not $500k. Unescaped $ is LaTeX.
- Break up dense text into short paragraphs (2-4 sentences max per paragraph). Add a blank line between paragraphs.
- Use bullet points for lists, but follow each bullet with a full sentence, not just a keyword.
- Use mermaid code blocks for diagrams. Each statement on its own line. Use <br/> for line breaks within node labels (never literal backslash-n). Always wrap labels in double quotes inside shape delimiters: A["Label"], B("Rounded"), C{"Decision"}. Quoting is critical when labels contain parentheses or slashes (e.g. A["System (Restart/Scale)"]). Wrap subgraph titles in quotes. Close each subgraph with 'end'. Never use "end" as a node ID (it is reserved). Avoid words containing "end" as a substring in labels (Send, Backend, Append, endpoint); use synonyms instead. ASCII-safe only, no em dashes. Never use markdown list syntax inside labels (no "- item", "* item", "1. step", or "1) step"); for numbered steps in edge labels use a colon "1:" not "1." to avoid "Unsupported markdown: list" errors.
- Use tables for comparisons or structured data.
- Use code blocks with language tags for code or config.
- Use Title Case for all headings and subheadings.
- For collapsible content use Obsidian callouts: \`> [!tip]- Title\`. EVERY line inside (including closing \`\`\`) MUST start with \`> \`. Do NOT use HTML <details> tags.
- Do not wrap the entire output in a markdown code fence.
- Do not include any conversational text. Output only the content to append.`;

type AIProvider = "claude" | "gemini" | "codex" | "ollama";

const PROVIDER_LABELS: Record<AIProvider, string> = { claude: "Claude", gemini: "Gemini", codex: "Codex", ollama: "Ollama" };

interface ClaudeExplainerSettings {
	claudePath: string;
	modelFlag: string;
	defaultModeId: string;
	lastModeId: string;
	customModes: NoteMode[];
	enableLogging: boolean;
	aiProvider: AIProvider;
	geminiPath: string;
	geminiModel: string;
	codexPath: string;
	codexModel: string;
	ollamaUrl: string;
	ollamaModel: string;
}

const DEFAULT_SETTINGS: ClaudeExplainerSettings = {
	claudePath: "claude",
	modelFlag: "",
	defaultModeId: "",
	lastModeId: "",
	customModes: [],
	enableLogging: true,
	aiProvider: "claude",
	geminiPath: "gemini",
	geminiModel: "",
	codexPath: "codex",
	codexModel: "",
	ollamaUrl: "http://localhost:11434",
	ollamaModel: "llama3",
};

const LOG_PREFIX = "[Second Brain Builder]";
const MAX_LOG_LINES = 500;

class Logger {
	private lines: string[] = [];
	private enabled = true;

	setEnabled(enabled: boolean) { this.enabled = enabled; }

	info(msg: string, ...data: unknown[]) {
		if (!this.enabled) return;
		const entry = `${this.timestamp()} INFO  ${msg}`;
		this.lines.push(entry);
		console.log(LOG_PREFIX, msg, ...data);
		this.trim();
	}

	error(msg: string, ...data: unknown[]) {
		const entry = `${this.timestamp()} ERROR ${msg}`;
		this.lines.push(entry);
		console.error(LOG_PREFIX, msg, ...data);
		this.trim();
	}

	warn(msg: string, ...data: unknown[]) {
		if (!this.enabled) return;
		const entry = `${this.timestamp()} WARN  ${msg}`;
		this.lines.push(entry);
		console.warn(LOG_PREFIX, msg, ...data);
		this.trim();
	}

	getLog(): string {
		return this.lines.join("\n");
	}

	clear() { this.lines = []; }

	private timestamp(): string {
		return new Date().toISOString().replace("T", " ").slice(0, 19);
	}

	private trim() {
		if (this.lines.length > MAX_LOG_LINES) {
			this.lines = this.lines.slice(-MAX_LOG_LINES);
		}
	}
}

const logger = new Logger();

const TITLE_CASE_MINOR = new Set([
	"a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so",
	"in", "on", "at", "to", "by", "of", "up", "as", "if", "is", "vs",
]);

function toTitleCase(str: string): string {
	return str.replace(/\S+/g, (word, index) => {
		if (index === 0 || !TITLE_CASE_MINOR.has(word.toLowerCase())) {
			return word.charAt(0).toUpperCase() + word.slice(1);
		}
		return word.toLowerCase();
	});
}

function sanitizeFilename(name: string): string {
	return toTitleCase(
		name
			.replace(/[\\/:*?"<>|]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 100)
	);
}

const MODAL_STYLES_ID = "claude-helper-modal-styles";

function setModalTitle(modal: Modal, title: string): void {
	if (typeof modal.setTitle === "function") {
		modal.setTitle(title);
	}
	if (modal.titleEl) {
		modal.titleEl.innerText = title;
	}
}

function ensureModalStyles(): void {
	if (document.getElementById(MODAL_STYLES_ID)) return;
	const style = document.createElement("style");
	style.id = MODAL_STYLES_ID;
	style.textContent = `
		.ch-modal { max-width: 620px; }
		.ch-modal .modal-content { padding: 16px 20px; }
		.ch-modal .modal-title { font-size: 18px; font-weight: 600; }
		.ch-label { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
		.ch-hint { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
		.ch-search { width: 100%; margin-bottom: 8px; }
		.ch-grid {
			display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
			margin-bottom: 14px; max-height: 260px; overflow-y: auto;
			padding-right: 4px;
		}
		.ch-card {
			display: flex; align-items: flex-start; gap: 10px;
			padding: 8px 12px; border: 1px solid var(--background-modifier-border);
			border-radius: 8px; cursor: pointer; transition: all 0.15s ease;
		}
		.ch-card:hover {
			background-color: var(--background-modifier-hover);
			border-color: var(--interactive-accent);
		}
		.ch-card.is-selected {
			background-color: var(--interactive-accent);
			border-color: var(--interactive-accent);
			color: var(--text-on-accent);
		}
		.ch-card.is-selected .ch-card-desc { color: var(--text-on-accent); opacity: 0.85; }
		.ch-card-icon { flex-shrink: 0; width: 18px; height: 18px; margin-top: 2px; opacity: 0.7; }
		.ch-card.is-selected .ch-card-icon { opacity: 1; }
		.ch-card-body { min-width: 0; }
		.ch-card-name { font-weight: 600; font-size: 13px; line-height: 1.3; }
		.ch-card-desc { font-size: 11px; color: var(--text-muted); line-height: 1.3; margin-top: 1px; }
		.ch-sep { border-top: 1px solid var(--background-modifier-border); padding-top: 12px; margin-top: 4px; }
		.ch-input { width: 100%; margin-bottom: 12px; }
		.ch-textarea { width: 100%; min-height: 50px; margin-bottom: 12px; }
		.ch-btn-row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
		.ch-format-row { display: flex; gap: 8px; margin-bottom: 10px; }
		.ch-empty { padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px; grid-column: 1 / -1; }
	`;
	document.head.appendChild(style);
}

function renderModeCard(container: HTMLElement, mode: NoteMode): HTMLElement {
	const card = container.createDiv({ cls: "ch-card" });
	const iconEl = card.createDiv({ cls: "ch-card-icon" });
	setIcon(iconEl, mode.icon);
	const body = card.createDiv({ cls: "ch-card-body" });
	body.createDiv({ cls: "ch-card-name", text: mode.name });
	body.createDiv({ cls: "ch-card-desc", text: mode.description });
	return card;
}

function createModeGrid(
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

	search.addEventListener("keydown", (e) => { e.stopPropagation(); });
	search.addEventListener("input", () => {
		const q = search.value.toLowerCase();
		for (const c of cards) {
			const mode = modes.find(m => m.id === c.id)!;
			const match = !q || mode.name.toLowerCase().includes(q) || mode.description.toLowerCase().includes(q);
			c.el.style.display = match ? "" : "none";
		}
	});

	return { grid, cards };
}

function extractJsonArray(raw: string): string {
	const start = raw.indexOf("[");
	const end = raw.lastIndexOf("]");
	if (start >= 0 && end > start) {
		return raw.slice(start, end + 1);
	}
	return raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
}

function fixCodeBlocks(content: string): string {
	return content.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang: string, inner: string) => {
		const fixed = inner.replace(/\\n/g, "\n");
		const ending = fixed.endsWith("\n") ? "" : "\n";
		return "```" + lang + "\n" + fixed + ending + "```";
	});
}

function fixMermaidBlocks(content: string): string {
	return content.replace(/```mermaid\n([\s\S]*?)```/g, (_match, inner: string) => {
		let fixed = inner.replace(/\\n/g, "\n");
		// Strip extra "end" keywords that have no matching subgraph
		let depth = 0;
		fixed = fixed.split("\n").filter(line => {
			const trimmed = line.trim();
			if (/^subgraph\b/.test(trimmed)) { depth++; return true; }
			if (trimmed === "end") { if (depth > 0) { depth--; return true; } return false; }
			return true;
		}).join("\n");
		// Break up "end" with zero-width space so the mermaid tokenizer doesn't see
		// the reserved keyword — both inside larger words (Send, Backend) and standalone
		// node IDs. Lines where "end" is the sole token are subgraph closers and kept as-is.
		const zwsp = "​";
		fixed = fixed.split("\n").map(line => {
			if (line.trim() === "end") return line;
			return line.replace(/end/g, "e" + zwsp + "nd");
		}).join("\n");
		// Fix "Unsupported markdown: list" — mermaid parses "1. text", "1) text"
		// as ordered lists and "- text" / "* text" as unordered lists in labels.
		const fixNumberedList = (label: string) => label
			.replace(/^(\d+)[.)]\s/gm, "$1: ")
			.replace(/(<br\/?>)(\d+)[.)]\s/gi, "$1$2: ");
		const fixUnorderedList = (label: string) => {
			if (!/(?:^|\n)\s*[-*] /m.test(label)) return label;
			return label.split(/\n/)
				.map((l: string) => l.replace(/^\s*[-*]\s+/, "").trim())
				.filter((l: string) => l.length > 0)
				.join("<br/>");
		};
		const fixMermaidLabel = (label: string) => fixNumberedList(fixUnorderedList(label));
		fixed = fixed.replace(/\|"([^"]*?)"\|/g, (_m, label: string) => {
			const newLabel = fixMermaidLabel(label);
			return newLabel === label ? _m : '|"' + newLabel + '"|';
		});
		fixed = fixed.replace(/\["([^\]]*?)"\]/g, (_m, label: string) => {
			const newLabel = fixMermaidLabel(label);
			return newLabel === label ? _m : '["' + newLabel + '"]';
		});
		// Quote unquoted node labels containing special chars that mermaid misparses
		// e.g. A[System (Restart/Scale)] → A["System (Restart/Scale)"]
		fixed = fixed.replace(/\[([^\]"]*[()\/\\][^\]"]*)\]/g, '["$1"]');
		fixed = fixed.replace(/\(([^)"]*[()][^)"]*)\)/g, '("$1")');
		if (!fixed.endsWith("\n")) fixed += "\n";
		return "```mermaid\n" + fixed + "```";
	});
}

function fixDetailsBlocks(content: string): string {
	return content.replace(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g,
		(_match, title: string, body: string) => {
			let cleaned = body;
			// Convert any <pre><code> blocks back to markdown fences
			cleaned = cleaned.replace(
				/<pre><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g,
				(_m, lang: string, code: string) => {
					const unescaped = code.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
					return "```" + (lang || "") + "\n" + unescaped + "```";
				}
			);
			const trimmed = cleaned.trim();
			const lines = trimmed.split("\n");
			const prefixed = lines.map(line => `> ${line}`).join("\n");
			return `> [!tip]- ${title.trim()}\n> \n${prefixed}`;
		}
	);
}

function fixCalloutCodeFences(content: string): string {
	const lines = content.split("\n");
	let inCallout = false;
	let inCalloutCode = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (inCalloutCode) {
			if (/^>\s*```\s*$/.test(line)) {
				inCalloutCode = false;
			} else if (/^```\s*$/.test(line)) {
				lines[i] = "> ```";
				inCalloutCode = false;
			} else if (!/^>/.test(line) && line.trim() !== "") {
				lines[i] = "> " + line;
			}
			continue;
		}

		if (/^>\s*\[!/.test(line)) {
			inCallout = true;
			inCalloutCode = false;
		} else if (inCallout && /^>\s*```\w*/.test(line)) {
			inCalloutCode = true;
		} else if (inCallout && !/^>/.test(line) && line.trim() !== "") {
			inCallout = false;
		}
	}

	return lines.join("\n");
}

function fixCurrencyDollars(content: string): string {
	// Escape $ signs used for currency (e.g. $1M, $500k, $10B) so Obsidian
	// doesn't interpret them as LaTeX delimiters. Skips inside code blocks and
	// existing LaTeX expressions.
	const lines = content.split("\n");
	let inCode = false;
	for (let i = 0; i < lines.length; i++) {
		if (/^```/.test(lines[i])) { inCode = !inCode; continue; }
		if (inCode) continue;
		// $<digits><letter> is currency, not LaTeX (e.g. $1M, $500k, $10B, $5mm)
		lines[i] = lines[i].replace(/(?<!\\)\$(\d+[A-Za-z])/g, "\\$$$1");
		// $<digits>,<digits> outside LaTeX is currency (e.g. $1,000 $28,800)
		lines[i] = lines[i].replace(/(?<!\\)\$(\d{1,3}(?:,\d{3})+)(?!\})/g, "\\$$$1");
		// $<digits>.<digits> followed by space/word (e.g. $1.5 million, $0.03 per)
		lines[i] = lines[i].replace(/(?<!\\)\$(\d+\.\d+\s+[a-zA-Z])/g, "\\$$$1");
	}
	return lines.join("\n");
}

function fixDataviewInlineQueries(content: string): string {
	// Dataview treats `= expression` (backtick-equals) as inline queries.
	// Escape by inserting a zero-width space after the opening backtick.
	return content.replace(/`(=\s)/g, "`​$1");
}

function isNoteEffectivelyEmpty(content: string): boolean {
	const stripped = content.replace(/^#\s+.*$/gm, "").trim();
	return stripped.length === 0;
}

// ─── Note Creator Modal (multi-select) ───────────────────────────

class NoteCreatorModal extends Modal {
	modes: NoteMode[];
	selection: string;
	lastModeId: string;
	onSubmit: (configs: NoteConfig[]) => void;
	onModeUsed: (modeId: string) => void;
	selectedModes: NoteMode[];
	titleValue: string;
	extraValue: string;
	btnEls: { id: string; el: HTMLElement }[];
	submitBtnEl: HTMLButtonElement | null;

	constructor(app: App, modes: NoteMode[], selection: string, lastModeId: string, onSubmit: (configs: NoteConfig[]) => void, onModeUsed?: (modeId: string) => void) {
		super(app);
		this.modes = modes;
		this.selection = String(selection || "");
		this.lastModeId = lastModeId;
		this.onSubmit = onSubmit;
		this.onModeUsed = onModeUsed || (() => {});
		this.selectedModes = [];
		this.titleValue = sanitizeFilename(this.selection);
		this.extraValue = "";
		this.btnEls = [];
		this.submitBtnEl = null;
	}

	onOpen(): void {
		ensureModalStyles();
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		setModalTitle(this, "Create Note");

		const wrapper = el.createDiv();

		wrapper.createDiv({ cls: "ch-label", text: "Note style" });
		wrapper.createDiv({ cls: "ch-hint", text: "Click multiple to blend styles into one note" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.toggleMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });

		sep.createDiv({ cls: "ch-label", text: "Note title" });
		const titleInput = sep.createEl("input", { type: "text", cls: "ch-input" });
		titleInput.value = this.titleValue;
		titleInput.addEventListener("input", () => { this.titleValue = titleInput.value; });
		titleInput.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter") { e.preventDefault(); this.doSubmit(); }
		});

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
	}

	updateModeButtons(): void {
		const selectedIds = new Set(this.selectedModes.map(m => m.id));
		for (const b of this.btnEls) {
			b.el.toggleClass("is-selected", selectedIds.has(b.id));
		}
		if (this.submitBtnEl) {
			if (this.selectedModes.length === 0) {
				this.submitBtnEl.disabled = true;
				this.submitBtnEl.setText("Select a note style");
			} else if (this.selectedModes.length === 1) {
				this.submitBtnEl.disabled = false;
				this.submitBtnEl.setText("Generate - " + this.selectedModes[0].name);
			} else {
				this.submitBtnEl.disabled = false;
				this.submitBtnEl.setText(`Generate blended - ${this.selectedModes.map(m => m.name).join(" + ")}`);
			}
		}
	}

	doSubmit(): void {
		if (this.selectedModes.length === 0) {
			new Notice("Pick at least one note style.");
			return;
		}
		const title = this.titleValue.trim();
		if (!title) {
			new Notice("Note title cannot be empty.");
			return;
		}
		const sanitizedTitle = sanitizeFilename(title);
		this.close();

		// Remember the last used mode (first selected)
		this.onModeUsed(this.selectedModes[0].id);

		let finalMode: NoteMode;
		if (this.selectedModes.length === 1) {
			finalMode = this.selectedModes[0];
		} else {
			finalMode = NoteCreatorModal.createBlendedMode(this.selectedModes);
		}

		this.onSubmit([{
			mode: finalMode,
			title: sanitizedTitle,
			extraInstructions: this.extraValue.trim(),
		}]);
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

class InlineActionModal extends Modal {
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
		ensureModalStyles();
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");

		const label = this.selection.length > 60 ? this.selection.slice(0, 60) + "..." : this.selection;
		setModalTitle(this, `Enhance: "${label}"`);

		const wrapper = el.createDiv();

		if (!this.preselectedAction) {
			wrapper.createDiv({ cls: "ch-label", text: "Action" });
			const grid = wrapper.createDiv({ cls: "ch-grid" });
			grid.style.gridTemplateColumns = "1fr 1fr 1fr";

			this.btnEls = [];
			for (const action of this.actions) {
				const card = renderModeCard(grid, action as NoteMode);
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
		extraInput.placeholder = "e.g. Focus on Python examples, keep it under 200 words...";
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

class FullNoteActionModal extends Modal {
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
		ensureModalStyles();
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
		extraInput.placeholder = "e.g. Focus on code-related questions, make exercises harder...";
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

class FillNoteModal extends Modal {
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
		ensureModalStyles();
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		setModalTitle(this, "Fill: " + this.fileName);

		const wrapper = el.createDiv();

		if (this.backlinkSources.length > 0) {
			const blInfo = wrapper.createDiv();
			blInfo.style.cssText = "padding: 8px 12px; background: var(--background-secondary); border-radius: 6px; margin-bottom: 12px;";
			blInfo.createDiv({ cls: "ch-label", text: `Context from ${this.backlinkSources.length} backlink${this.backlinkSources.length > 1 ? "s" : ""}:` });
			for (const src of this.backlinkSources) {
				blInfo.createDiv({ cls: "ch-hint", text: "  " + src });
			}
		} else {
			wrapper.createDiv({ cls: "ch-hint", text: "No backlinks found. Provide context below or leave empty for a general note." });
		}

		wrapper.createDiv({ cls: "ch-label", text: this.backlinkSources.length > 0 ? "Context (from backlinks, editable)" : "Context (describe what this note should cover)" });
		const ctxInput = wrapper.createEl("textarea", { cls: "ch-textarea" });
		ctxInput.value = this.contextValue;
		ctxInput.placeholder = "e.g. This note should explain how binary search works, with examples in Python...";
		ctxInput.style.minHeight = "80px";
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

// ─── Topic Generator Modal ──────────────────────────────────────

class TopicGeneratorModal extends Modal {
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
		ensureModalStyles();
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		setModalTitle(this, "Generate Notes from Topic");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: "Location: " + (this.folderPath || "/") });

		wrapper.createDiv({ cls: "ch-label", text: "Topic" });
		const topicInput = wrapper.createEl("input", { type: "text", cls: "ch-input" });
		topicInput.placeholder = "e.g. Binary Search Trees, Docker Networking, Calculus Integration...";
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

		sep.createDiv({ cls: "ch-hint", text: "Multi-note: Claude decomposes the topic into linked sub-notes in a folder" });

		wrapper.createDiv({ cls: "ch-label", text: "Extra instructions (optional)" });
		const extraInput = wrapper.createEl("textarea", { cls: "ch-textarea" });
		extraInput.placeholder = "e.g. Focus on practical examples, target intermediate level, include Python code...";
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

class FolderGeneratorModal extends Modal {
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
		ensureModalStyles();
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		this.modalEl.style.maxWidth = "720px";
		setModalTitle(this, "Generate Knowledge Notes");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: `Target folder: ${this.folderPath || "/"}` });

		wrapper.createDiv({ cls: "ch-label", text: "Scenario / Prompt" });
		const scenarioInput = wrapper.createEl("textarea", { cls: "ch-textarea" });
		scenarioInput.placeholder = "e.g. Design a website that shows the current time, needs auth, available globally, never goes down...\n\nOr: Explain the SOLID principles with real-world examples...\n\nOr: Cover the sliding window pattern for arrays and strings...";
		scenarioInput.rows = 5;
		scenarioInput.style.minHeight = "120px";
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
		extraInput.placeholder = "e.g. Target senior-level depth, include Java examples, focus on AWS services...";
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

// ─── Folder Analysis Modal ───────────────────────────────────────

class FolderAnalysisModal extends Modal {
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
		ensureModalStyles();
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		this.modalEl.style.maxWidth = "720px";
		setModalTitle(this, "Analyze Folder");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: `Analyzing: ${this.folderPath || "/"}` });
		wrapper.createDiv({ cls: "ch-hint", text: "All notes in this folder will be read as context." });

		wrapper.createDiv({ cls: "ch-label", text: "Analysis mode" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.pickMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });
		sep.createDiv({ cls: "ch-label", text: "Additional content (articles, context, instructions)" });
		const extraInput = sep.createEl("textarea", { cls: "ch-textarea" });
		extraInput.placeholder = "Paste articles, blog posts, or extra context here...\n\nFor Design Hole Finder: optional, leave empty to analyze existing notes.\nFor Enrich from Articles: paste the source material here.";
		extraInput.rows = 8;
		extraInput.style.minHeight = "160px";
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

// ─── Add Topic Modal ─────────────────────────────────────────────

class AddTopicModal extends Modal {
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
		ensureModalStyles();
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		this.modalEl.style.maxWidth = "720px";
		setModalTitle(this, "Add Topic to Folder");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: `Folder: ${this.folderPath || "/"}` });
		wrapper.createDiv({ cls: "ch-hint", text: "Existing notes in this folder will be used as context for the new note." });

		wrapper.createDiv({ cls: "ch-label", text: "Topic to add" });
		const topicInput = wrapper.createEl("textarea", { cls: "ch-textarea" });
		topicInput.placeholder = "e.g. Write-Ahead Log (WAL)\n\nThe missing topic that should be added to this folder. A single note will be generated using existing notes as context.";
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
		extraInput.placeholder = "e.g. Focus on crash recovery aspects, include Go code examples...";
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

class ExpandFolderModal extends Modal {
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
		ensureModalStyles();
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		this.modalEl.style.maxWidth = "720px";
		setModalTitle(this, "Expand Folder with More Notes");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: `Folder: ${this.folderPath || "/"}` });
		wrapper.createDiv({ cls: "ch-hint", text: `${this.existingNotes.length} existing notes will be read as context. New notes will not repeat existing content.` });

		if (this.existingNotes.length > 0) {
			const existingEl = wrapper.createDiv();
			existingEl.style.fontSize = "12px";
			existingEl.style.color = "var(--text-muted)";
			existingEl.style.marginBottom = "8px";
			existingEl.style.maxHeight = "80px";
			existingEl.style.overflowY = "auto";
			existingEl.createEl("strong", { text: "Existing: " });
			existingEl.createSpan({ text: this.existingNotes.join(", ") });
		}

		wrapper.createDiv({ cls: "ch-label", text: "What to add" });
		const dirInput = wrapper.createEl("textarea", { cls: "ch-textarea" });
		dirInput.placeholder = "e.g. Add notes covering concurrency patterns, thread safety, and lock-free data structures\n\nOr: Expand with real-world case studies and failure post-mortems\n\nOr: Add notes on the networking and security aspects I haven't covered yet";
		dirInput.rows = 4;
		dirInput.style.minHeight = "100px";
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
		extraInput.placeholder = "e.g. Target senior-level depth, include Python examples...";
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

// ─── Note Analysis Modal ─────────────────────────────────────────

class NoteAnalysisModal extends Modal {
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
		ensureModalStyles();
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		this.modalEl.style.maxWidth = "720px";
		setModalTitle(this, "Analyze Note");

		const wrapper = el.createDiv();
		wrapper.createDiv({ cls: "ch-hint", text: `Analyzing: ${this.file.basename}` });

		wrapper.createDiv({ cls: "ch-label", text: "Analysis mode" });

		const { cards } = createModeGrid(wrapper, this.modes, (mode) => this.pickMode(mode));
		this.btnEls = cards;

		const sep = wrapper.createDiv({ cls: "ch-sep" });
		sep.createDiv({ cls: "ch-label", text: "Additional content (articles, context, instructions)" });
		const extraInput = sep.createEl("textarea", { cls: "ch-textarea" });
		extraInput.placeholder = "Paste articles, blog posts, or extra context here...\n\nFor Design Hole Finder: optional, leave empty to analyze the note as-is.\nFor Enrich from Articles: paste the source material here.";
		extraInput.rows = 8;
		extraInput.style.minHeight = "160px";
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

// ─── Queue Status Modal ──────────────────────────────────────────

class QueueStatusModal extends Modal {
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
		setModalTitle(this, "Generation Queue");

		const wrapper = el.createDiv();
		wrapper.style.padding = "8px";
		wrapper.style.minWidth = "500px";

		this.headerEl = wrapper.createDiv();
		this.headerEl.style.marginBottom = "12px";

		this.timerEl = wrapper.createDiv();
		this.timerEl.style.fontSize = "12px";
		this.timerEl.style.color = "var(--text-muted)";
		this.timerEl.style.marginBottom = "8px";

		const previewLabel = wrapper.createDiv();
		previewLabel.setText("Live output");
		previewLabel.style.fontWeight = "600";
		previewLabel.style.fontSize = "13px";
		previewLabel.style.marginBottom = "4px";

		this.previewEl = wrapper.createEl("pre");
		this.previewEl.style.maxHeight = "300px";
		this.previewEl.style.overflowY = "auto";
		this.previewEl.style.padding = "10px";
		this.previewEl.style.fontSize = "12px";
		this.previewEl.style.border = "1px solid var(--background-modifier-border)";
		this.previewEl.style.borderRadius = "6px";
		this.previewEl.style.backgroundColor = "var(--background-secondary)";
		this.previewEl.style.whiteSpace = "pre-wrap";
		this.previewEl.style.wordBreak = "break-word";
		this.previewEl.style.marginBottom = "12px";

		this.queueListEl = wrapper.createDiv();
		this.queueListEl.style.marginBottom = "8px";

		this.failedListEl = wrapper.createDiv();
		this.failedListEl.style.marginBottom = "8px";

		this.completedListEl = wrapper.createDiv();
		this.completedListEl.style.marginBottom = "8px";

		const btnContainer = wrapper.createDiv();
		btnContainer.style.display = "flex";
		btnContainer.style.gap = "8px";

		const clearBtn = btnContainer.createEl("button", { text: "Clear pending queue" });
		clearBtn.style.flex = "1";
		clearBtn.addEventListener("click", () => {
			this.plugin.clearQueue();
			this.refresh();
		});

		const retryAllBtn = btnContainer.createEl("button", { text: "Retry all failed" });
		retryAllBtn.style.flex = "1";
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
				const h = this.headerEl.createEl("h3");
				h.setText("Generating: " + this.getItemLabelLocal(processing));
				h.style.margin = "0";
				const badge = this.headerEl.createEl("span");
				badge.setText(this.getItemModeName(processing));
				badge.style.fontSize = "12px";
				badge.style.color = "var(--text-on-accent)";
				badge.style.backgroundColor = "var(--interactive-accent)";
				badge.style.padding = "2px 8px";
				badge.style.borderRadius = "10px";
				badge.style.marginLeft = "8px";
				badge.style.verticalAlign = "middle";
			} else {
				this.headerEl.setText("");
				const h = this.headerEl.createEl("h3");
				h.setText("Queue idle");
				h.style.margin = "0";
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
					this.previewEl.setText("Waiting for Claude to respond...");
				}
				this.previewEl.scrollTop = this.previewEl.scrollHeight;
			} else {
				this.previewEl.setText("No active generation.");
			}
		}

		if (this.queueListEl) {
			this.queueListEl.setText("");
			if (queue.length > 0) {
				const label = this.queueListEl.createDiv();
				label.setText("Up next (" + queue.length + ")");
				label.style.fontWeight = "600";
				label.style.fontSize = "13px";
				label.style.marginBottom = "4px";

				for (let i = 0; i < queue.length; i++) {
					const q = queue[i];
					const row = this.queueListEl.createDiv();
					row.style.display = "flex";
					row.style.alignItems = "center";
					row.style.padding = "4px 0";

					const nameSpan = row.createEl("span");
					nameSpan.setText((i + 1) + ". " + this.getItemLabelLocal(q) + " - " + this.getItemModeName(q));
					nameSpan.style.flex = "1";
					nameSpan.style.fontSize = "13px";

					const removeBtn = row.createEl("button", { text: "x" });
					removeBtn.style.fontSize = "12px";
					removeBtn.style.padding = "2px 6px";
					removeBtn.style.cursor = "pointer";
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
				const label = this.failedListEl.createDiv();
				label.setText("Failed (" + failedItems.length + ")");
				label.style.fontWeight = "600";
				label.style.fontSize = "13px";
				label.style.marginBottom = "4px";
				label.style.color = "var(--text-error)";

				for (let i = 0; i < failedItems.length; i++) {
					const f = failedItems[i];
					const row = this.failedListEl.createDiv();
					row.style.display = "flex";
					row.style.alignItems = "center";
					row.style.padding = "4px 0";
					row.style.gap = "6px";

					const nameSpan = row.createEl("span");
					nameSpan.style.flex = "1";
					nameSpan.style.fontSize = "13px";
					const itemName = this.getItemLabelLocal(f.item);
					const shortErr = f.error.length > 60 ? f.error.slice(0, 60) + "..." : f.error;
					nameSpan.setText(itemName + " - " + shortErr);
					nameSpan.style.color = "var(--text-muted)";

					const retryBtn = row.createEl("button", { text: "Retry" });
					retryBtn.style.fontSize = "12px";
					retryBtn.style.padding = "2px 8px";
					retryBtn.style.cursor = "pointer";
					retryBtn.addEventListener("click", () => {
						this.plugin.retryOne(i);
						this.refresh();
					});

					const dismissBtn = row.createEl("button", { text: "x" });
					dismissBtn.style.fontSize = "12px";
					dismissBtn.style.padding = "2px 6px";
					dismissBtn.style.cursor = "pointer";
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
				const label = this.completedListEl.createDiv();
				label.setText("Completed (" + completedItems.length + ")");
				label.style.fontWeight = "600";
				label.style.fontSize = "13px";
				label.style.marginBottom = "4px";
				label.style.color = "var(--text-success)";

				const shown = completedItems.slice(-20).reverse();
				for (const c of shown) {
					const row = this.completedListEl.createDiv();
					row.style.display = "flex";
					row.style.alignItems = "center";
					row.style.padding = "3px 0";
					row.style.fontSize = "12px";
					row.style.color = "var(--text-muted)";

					const nameSpan = row.createEl("span");
					nameSpan.setText(this.getItemLabelLocal(c.item));
					nameSpan.style.flex = "1";

					const secs = Math.round(c.elapsed / 1000);
					const statsSpan = row.createEl("span");
					statsSpan.setText(`${(c.chars / 1000).toFixed(1)}k chars, ${secs}s`);
					statsSpan.style.marginLeft = "8px";
					statsSpan.style.whiteSpace = "nowrap";
				}

				if (completedItems.length > 20) {
					const moreEl = this.completedListEl.createDiv();
					moreEl.setText(`...and ${completedItems.length - 20} more`);
					moreEl.style.fontSize = "11px";
					moreEl.style.color = "var(--text-faint)";
					moreEl.style.marginTop = "2px";
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

// ─── Scale Calculator Modal ─────────────────────────────────────

class ScaleCalculatorModal extends Modal {
	onInsert: (markdown: string) => void;

	constructor(app: App, onInsert: (markdown: string) => void) {
		super(app);
		this.onInsert = onInsert;
	}

	onOpen(): void {
		ensureModalStyles();
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		setModalTitle(this, "Scale Estimation Calculator");

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
		const btn = btnRow.createEl("button", { text: "Generate & Insert" });
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

class ScaffoldWorkspaceModal extends Modal {
	onSubmit: (name: string, sections: string[]) => void;
	selectedSections: Set<string>;

	constructor(app: App, onSubmit: (name: string, sections: string[]) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.selectedSections = new Set(["Systems", "Patterns", "Components", "Failures", "Tradeoffs", "Simulations", "Glossary"]);
	}

	onOpen(): void {
		ensureModalStyles();
		const el = this.contentEl;
		el.empty();
		this.modalEl.addClass("ch-modal");
		setModalTitle(this, "Scaffold System Design Workspace");

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
			card.style.cursor = "pointer";

			const cb = card.createEl("input", { type: "checkbox" });
			cb.checked = true;
			cb.style.marginRight = "8px";
			cb.style.flexShrink = "0";

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
		const btn = btnRow.createEl("button", { text: "Create Workspace" });
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
			this.onSubmit(name, Array.from(this.selectedSections));
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ─── Log Viewer Modal ────────────────────────────────────────────

class LogViewerModal extends Modal {
	private interval: ReturnType<typeof setInterval> | null = null;
	private pre: HTMLPreElement | null = null;
	private lastLen = -1;

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("ch-modal");
		setModalTitle(this, "Second Brain Builder Logs");

		const btnRow = contentEl.createDiv({ attr: { style: "margin-bottom: 8px; display: flex; gap: 8px;" } });
		const copyBtn = btnRow.createEl("button", { text: "Copy to clipboard" });
		copyBtn.onclick = () => {
			navigator.clipboard.writeText(logger.getLog());
			new Notice("Logs copied to clipboard");
		};
		const clearBtn = btnRow.createEl("button", { text: "Clear logs" });
		clearBtn.onclick = () => {
			logger.clear();
			this.lastLen = -1;
			this.refresh();
			new Notice("Logs cleared");
		};

		this.pre = contentEl.createEl("pre", {
			attr: { style: "max-height: 400px; overflow: auto; font-size: 11px; padding: 8px; background: var(--background-secondary); border-radius: 4px; white-space: pre-wrap; word-break: break-all;" },
		});

		this.refresh();
		this.interval = setInterval(() => this.refresh(), 1000);
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
		if (this.interval) clearInterval(this.interval);
		this.contentEl.empty();
	}
}

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
						this.enqueueNote(editor, view, selection, config, linkReplacement);
					}
				}, (modeId) => this.saveLastMode(modeId)).open();
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
					this.enqueueAppend(editor, file, mode, extraInstructions);
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
					this.generateTopicNotes(topic, mode, isMulti, folderPath, extraInstructions);
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
						this.enqueueFillNote(file, mode, ctx, extraInstructions);
					},
					(modeId) => this.saveLastMode(modeId),
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
										this.enqueueNote(editor, view, selection, config, linkReplacement);
									}
								}, (modeId) => this.saveLastMode(modeId)).open();
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
						const sub = (item as any).setTitle("Claude actions")
							.setIcon("sparkles")
							.setSubmenu() as Menu;

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
										this.enqueueAppend(editor, file, mode, extraInstructions);
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
											this.enqueueFillNote(file, mode, ctx, extraInstructions);
										},
										(modeId) => this.saveLastMode(modeId),
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
									this.generateKnowledgeNotes(scenario, mode, file.path, extraInstructions);
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
									this.addTopicToFolder(topic, mode, file, extraInstructions);
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
									this.expandFolderNotes(direction, mode, file, extraInstructions);
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
									this.analyzeFolderNotes(file, mode, extraContent);
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
									this.analyzeExistingNote(file, mode, extraContent);
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
						this.generateKnowledgeNotes(scenario, mode, folderPath, extraInstructions);
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
			this.processQueue();
		}
	}

	retryOne(index: number) {
		if (index < 0 || index >= this.failedItems.length) return;
		const [removed] = this.failedItems.splice(index, 1);
		this.queue.push(removed.item);
		this.updateStatusBar();
		new Notice(`Re-queued "${this.getItemLabel(removed.item)}".`);
		if (!this.isProcessing) {
			this.processQueue();
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
			this.processQueue();
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
			this.processQueue();
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
			this.processQueue();
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
			this.processQueue();
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
				this.processQueue();
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
				subtopics = JSON.parse(jsonStr);
			} catch {
				new Notice("Failed to parse topic decomposition. Falling back to single note.", 8000);
				console.error("Claude topic decomposition parse error. Raw response:", rawResponse);
				this.generateTopicNotes(topic, mode, false, folderPath, extraInstructions);
				return;
			}

			if (!Array.isArray(subtopics) || subtopics.length === 0) {
				new Notice("No sub-topics generated. Falling back to single note.", 5000);
				this.generateTopicNotes(topic, mode, false, folderPath, extraInstructions);
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
				this.processQueue();
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Failed to plan topic notes: ${msg}`, 8000);
			console.error("Claude topic planning error:", err);
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
				subtopics = JSON.parse(jsonStr);
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
				this.processQueue();
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
			this.processQueue();
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
				subtopics = JSON.parse(jsonStr);
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
				this.processQueue();
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
			this.processQueue();
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
				subtopics = JSON.parse(jsonStr);
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
				this.processQueue();
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
			let codexOutputFile: string | null = null;

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
				// captured via --output-last-message instead.
				codexOutputFile = join(tmpdir(), `second-brain-builder-codex-${Date.now()}.md`);
				args = [
					"exec",
					"--sandbox", "read-only",
					"--skip-git-repo-check",
					"--output-last-message", codexOutputFile,
				];
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

			const proc = spawn(execPath, args, {
				shell: true,
				windowsHide: true,
			});

			let stdout = "";
			let stderr = "";

			proc.stdout.on("data", (data: Buffer) => {
				const chunk = data.toString();
				stdout += chunk;
				this.streamData.currentOutput = stdout;
			});
			proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

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
					let result = stdout.trim();
					if (codexOutputFile) {
						try {
							const lastMessage = readFileSync(codexOutputFile, "utf8").trim();
							if (lastMessage) result = lastMessage;
						} catch { /* fall back to stdout */ }
						try { unlinkSync(codexOutputFile); } catch { /* ignore */ }
					}
					logger.info(`${providerLabel} responded successfully`);
					resolve(result);
				}
			});

			proc.on("error", (err: Error) => {
				logger.error(`Spawn error: ${err.message}`);
				reject((err as NodeJS.ErrnoException).code === "ENOENT" ? cliNotFoundError() : err);
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
			stream: true,
		});

		logger.info(`Ollama request: ${url}, model=${this.settings.ollamaModel}, prompt=${prompt.length} chars`);

		let response: Response;
		try {
			response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			});
		} catch (err: any) {
			throw new Error(`Ollama connection failed: ${err.message}. Is Ollama running at ${this.settings.ollamaUrl}?`);
		}

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Ollama error (${response.status}): ${text}`);
		}

		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		let output = "";
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop()!;
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const json = JSON.parse(line);
					if (json.error) {
						throw new Error(`Ollama: ${json.error}`);
					}
					if (json.response) {
						output += json.response;
						this.streamData.currentOutput = output;
					}
				} catch (e: any) {
					if (e.message.startsWith("Ollama:")) throw e;
				}
			}
		}

		if (buffer.trim()) {
			try {
				const json = JSON.parse(buffer);
				if (json.response) output += json.response;
			} catch { /* ignore trailing incomplete chunk */ }
		}

		logger.info(`Ollama responded successfully, ${output.length} chars`);
		return output.trim();
	}
}

// ─── Settings Tab ────────────────────────────────────────────────

class ClaudeExplainerSettingTab extends PluginSettingTab {
	plugin: ClaudeExplainerPlugin;

	constructor(app: App, plugin: ClaudeExplainerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Second Brain Builder Settings" });

		new Setting(containerEl)
			.setName("AI Provider")
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
				const recEl = containerEl.createDiv({ cls: "setting-item" });
				recEl.style.borderLeft = "3px solid var(--interactive-accent)";
				recEl.style.paddingLeft = "12px";
				recEl.style.marginBottom = "12px";
				const recTitle = recEl.createEl("strong", { text: activeModel.label });
				recTitle.style.display = "block";
				recTitle.style.marginBottom = "4px";
				const recDesc = recEl.createEl("span", { text: activeModel.desc });
				recDesc.style.color = "var(--text-muted)";
				recDesc.style.fontSize = "13px";
			}

			// Model comparison table
			containerEl.createEl("h3", { text: "Model Comparison" });
			const table = containerEl.createEl("table");
			table.style.width = "100%";
			table.style.fontSize = "13px";
			table.style.borderCollapse = "collapse";
			const thead = table.createEl("thead");
			const headerRow = thead.createEl("tr");
			for (const h of ["Model", "Size", "Speed", "Best For"]) {
				const th = headerRow.createEl("th", { text: h });
				th.style.textAlign = "left";
				th.style.padding = "6px 8px";
				th.style.borderBottom = "1px solid var(--background-modifier-border)";
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
					const td = tr.createEl("td", { text: cell });
					td.style.padding = "6px 8px";
					td.style.borderBottom = "1px solid var(--background-modifier-border)";
				}
			}

			// Ollama setup guide
			containerEl.createEl("h3", { text: "Ollama Setup Guide" });
			const guideEl = containerEl.createDiv();
			guideEl.style.fontSize = "13px";
			guideEl.style.color = "var(--text-muted)";
			guideEl.style.lineHeight = "1.6";

			const steps = [
				{ title: "1. Install Ollama", text: "Download and install from ollama.com. Available for Windows, macOS, and Linux." },
				{ title: "2. Start the server", text: "Open a terminal and run: ollama serve. This starts the API server on localhost:11434. Keep the terminal open while using the plugin." },
				{ title: "3. Pull a model", text: "In a separate terminal, pull the model you want to use:" },
				{ title: "", text: "ollama pull qwen3.5:latest" },
				{ title: "", text: "ollama pull gemma4:e4b" },
				{ title: "", text: "ollama pull gpt-oss:20b" },
				{ title: "4. Verify", text: "Run: ollama list to confirm your models are downloaded. Then select a model above and generate a note to test." },
			];

			for (const step of steps) {
				const stepEl = guideEl.createDiv();
				stepEl.style.marginBottom = "6px";
				if (step.title) {
					const titleEl = stepEl.createEl("strong", { text: step.title });
					titleEl.style.display = "block";
					titleEl.style.color = "var(--text-normal)";
					titleEl.style.marginTop = "8px";
				}
				if (step.title === "" ) {
					const codeEl = stepEl.createEl("code", { text: step.text });
					codeEl.style.display = "block";
					codeEl.style.padding = "4px 8px";
					codeEl.style.backgroundColor = "var(--background-secondary)";
					codeEl.style.borderRadius = "4px";
					codeEl.style.fontFamily = "var(--font-monospace)";
					codeEl.style.marginLeft = "16px";
				} else {
					stepEl.createSpan({ text: step.text });
				}
			}

			// Platform-specific notes
			containerEl.createEl("h3", { text: "Platform Notes" });
			const platformEl = containerEl.createDiv();
			platformEl.style.fontSize = "13px";
			platformEl.style.color = "var(--text-muted)";
			platformEl.style.lineHeight = "1.6";

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
				const pEl = platformEl.createDiv();
				pEl.style.marginBottom = "12px";
				pEl.style.padding = "8px 12px";
				pEl.style.backgroundColor = "var(--background-secondary)";
				pEl.style.borderRadius = "6px";
				const pTitle = pEl.createEl("strong", { text: platform.name });
				pTitle.style.display = "block";
				pTitle.style.color = "var(--text-normal)";
				pTitle.style.marginBottom = "4px";
				const ul = pEl.createEl("ul");
				ul.style.margin = "0";
				ul.style.paddingLeft = "20px";
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

		containerEl.createEl("h3", { text: "Built-in Note Modes" });
		const builtinList = containerEl.createEl("p");
		builtinList.setText((BUILTIN_MODES as NoteMode[]).map(m => m.name).join(", "));
		builtinList.style.color = "var(--text-muted)";
		builtinList.style.fontSize = "13px";

		containerEl.createEl("h3", { text: "Inline Actions" });
		const inlineList = containerEl.createEl("p");
		inlineList.setText(INLINE_ACTIONS.map(a => a.name).join(", "));
		inlineList.style.color = "var(--text-muted)";
		inlineList.style.fontSize = "13px";

		containerEl.createEl("h3", { text: "Custom Modes" });
		containerEl.createEl("p", {
			text: "Add your own modes. Each mode needs an ID, name, description, and prompt template. Use {selection} and {context} as placeholders in your prompt.",
			cls: "setting-item-description",
		});

		for (let i = 0; i < this.plugin.settings.customModes.length; i++) {
			const mode = this.plugin.settings.customModes[i];
			const modeContainer = containerEl.createDiv();
			modeContainer.style.border = "1px solid var(--background-modifier-border)";
			modeContainer.style.borderRadius = "8px";
			modeContainer.style.padding = "12px";
			modeContainer.style.marginBottom = "8px";

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
					text.inputEl.style.width = "100%";
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
