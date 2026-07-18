import { Editor, EditorPosition } from "obsidian";

export interface NoteMode {
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

export interface InlineAction {
	id: string;
	name: string;
	icon: string;
	description: string;
	prompt: string;
}

export interface NoteConfig {
	mode: NoteMode;
	title: string;
	extraInstructions: string;
	subfolder?: string;
	seriesInstructions?: string;
	contextOverride?: string;
}

export interface InlineActionConfig {
	action: InlineAction;
	insertionMode: "replace" | "below";
	extraInstructions: string;
}

export interface PendingLinkReplacement {
	editor: Editor;
	from: EditorPosition;
	to: EditorPosition;
	selection: string;
	linksText: string;
	applied: boolean;
}

export interface NoteQueueItem {
	type: "note";
	selection: string;
	noteName: string;
	newNotePath: string;
	fullPrompt: string;
	mode: NoteMode;
	editor: Editor;
	linkReplacement?: PendingLinkReplacement;
}

export interface InlineQueueItem {
	type: "inline";
	selection: string;
	fullPrompt: string;
	action: InlineAction;
	editor: Editor;
	from: EditorPosition;
	to: EditorPosition;
	insertionMode: "replace" | "below";
}

export interface AppendQueueItem {
	type: "append";
	filePath: string;
	fileName: string;
	fullPrompt: string;
	mode: NoteMode;
}

export interface TopicNoteQueueItem {
	type: "topic-note";
	noteName: string;
	newNotePath: string;
	fullPrompt: string;
	mode: NoteMode;
	renameFromContent?: boolean;
}

export type QueueItem = NoteQueueItem | InlineQueueItem | AppendQueueItem | TopicNoteQueueItem;

export type AIProvider = "claude" | "gemini" | "codex" | "ollama";

export const PROVIDER_LABELS: Record<AIProvider, string> = { claude: "Claude", gemini: "Gemini", codex: "Codex", ollama: "Ollama" };

export interface ClaudeExplainerSettings {
	claudePath: string;
	modelFlag: string;
	defaultModeId: string;
	lastModeId: string;
	lastSubfolder: string;
	customModes: NoteMode[];
	enableLogging: boolean;
	aiProvider: AIProvider;
	geminiPath: string;
	geminiModel: string;
	codexPath: string;
	codexModel: string;
	ollamaUrl: string;
	ollamaModel: string;
	setupNoticeShown: boolean;
}

export const DEFAULT_SETTINGS: ClaudeExplainerSettings = {
	claudePath: "claude",
	modelFlag: "",
	defaultModeId: "",
	lastModeId: "",
	lastSubfolder: "Deep Dives",
	customModes: [],
	enableLogging: true,
	aiProvider: "claude",
	geminiPath: "gemini",
	geminiModel: "",
	codexPath: "codex",
	codexModel: "",
	ollamaUrl: "http://localhost:11434",
	ollamaModel: "llama3",
	setupNoticeShown: false,
};
