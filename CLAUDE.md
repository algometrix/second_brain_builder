# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An Obsidian plugin ("Second Brain Builder") that generates detailed explanation notes using Claude Code CLI, Gemini CLI, Codex CLI, or a local Ollama server. Users select text in a note, pick a teaching style (mode), and the plugin spawns the CLI to produce a new note or inline enhancement. Desktop only; supports Windows, macOS, and Linux.

## Build Commands

```bash
npm install          # install dependencies
npm run build        # type-check (tsc -noEmit) + production bundle
npm run dev          # esbuild watch mode (rebuilds on save)
```

The build produces `main.js` (CJS bundle) from the single entry point `main.ts` via esbuild. Use the [Hot-Reload plugin](https://github.com/pjeby/hot-reload) in Obsidian for live dev.

## Project Structure

Source lives in `src/`, bundled to a single root `main.js` by esbuild (entry point `src/main.ts`).

- **src/main.ts** -- `ClaudeExplainerPlugin`: commands, context menus, the generation queue, CLI/Ollama providers, note orchestration
- **src/types.ts** -- shared interfaces: modes, inline actions, queue items, settings (+ defaults), provider labels
- **src/inline-actions.ts** -- the `INLINE_ACTIONS` catalog (expand, simplify, add diagram, ...)
- **src/output-rules.ts** -- formatting rules appended to every prompt (`getOutputRules`, inline/append variants)
- **src/cli.ts** -- typed `child_process.spawn` boundary (`SpawnedCliProcess`, `spawnCli`)
- **src/logger.ts** -- in-memory ring logger behind the "Enable logging" setting
- **src/utils.ts** -- filename sanitizing, JSON array extraction, empty-note detection
- **src/ui.ts** -- shared modal helpers (title, mode cards, searchable mode grid)
- **src/fixers.ts** -- output post-processing fixers (code fences, mermaid, callouts, dataview, currency)
- **src/modals/** -- one file per modal family: `generation.ts`, `folder.ts`, `analysis.ts`, `queue.ts`, `system-design.ts`
- **src/settings-tab.ts** -- the settings UI, including per-provider setup guides
- **modes.json** -- note generation modes loaded as `BUILTIN_MODES` at build time. Gitignored; resolved before every build by `scripts/sync-modes.js` (from `modes.config.json`'s `modesFile` if present, else an existing `modes.json`, else `modes.sample.json`)
- **modes.sample.json** -- committed sample set of general-purpose modes (Explain, Deep Inquiry, Feynman, etc.); the default build input for fresh clones
- **modes.config.json** -- optional, gitignored; `{ "modesFile": "<path>" }` points the build at a personal modes file (conventionally `modes.personal.json`, also gitignored)
- **styles.css** -- modal and queue UI styles
- **manifest.json** -- Obsidian plugin manifest (id: `second-brain-builder`)
- **scripts/** -- build helpers and vault fix scripts:
  - **sync-modes.js** -- prepares `modes.json` before builds (see above); wired into `npm run build` and `npm run dev`
  - **vault-root.js** -- shared vault path resolution for the fix scripts (first non-flag CLI argument, `OBSIDIAN_VAULT` env var, or `OBSIDIAN_VAULT=` in a gitignored repo-root `.env`)
  - **fix-all.js** -- unified runner that executes all fix scripts below in order
  - **fix-callout-fences.js** -- fixes callout code fences missing the `> ` prefix on closing ``` or content lines
  - **fix-currency-dollars.js** -- escapes unescaped `$` currency signs that Obsidian misinterprets as LaTeX
  - **fix-mermaid-end.js** -- strips extra `end` keywords with no matching block opener (subgraph, or sequence-diagram par/alt/opt/loop/rect/critical/break/box) and inserts zero-width space into "end" inside larger words
  - **fix-mermaid-missing-end.js** -- re-inserts missing `end` keywords (indentation-based placement) and puts the closing ``` fence on its own line
  - **fix-split-end.js** -- rejoins lines corrupted by an old regex that split words like "Send" into "S\nend"
  - **fix-mermaid-parens.js** -- quotes unquoted mermaid node labels containing parentheses or slashes
  - **fix-mermaid-quotes.js** -- strips nested double quotes inside already-quoted mermaid labels (inner `"` to `'`)
  - **fix-mermaid-list.js** -- fixes "Unsupported markdown: list" errors by converting `N.`/`N)` to `N:` in labels and joining `- item` lines with `<br/>`

All fix scripts share the same interface: `node scripts/<script> <vault-path>` for detect-only, add `--fix` to apply. The vault path can also come from the `OBSIDIAN_VAULT` environment variable or a gitignored repo-root `.env` file.

## Architecture

### Core Flow

1. User selects text, invokes a command (palette or hotkey)
2. A modal (`NoteCreatorModal`, `InlineActionModal`, etc.) lets the user pick a mode/action and configure options
3. The plugin builds a prompt by substituting `{selection}` and `{context}` placeholders in the mode's prompt template, then appends output rules (`getOutputRules()` / `INLINE_OUTPUT_RULES` / `APPEND_OUTPUT_RULES`)
4. The request is enqueued as a `QueueItem` (four types: `note`, `inline`, `append`, `topic-note`)
5. `processQueue()` processes items sequentially, calling `runClaude()` which spawns the CLI via `child_process.spawn`
6. Output goes through five post-processing fixers: `fixCodeBlocks`, `fixMermaidBlocks`, `fixDetailsBlocks`, `fixCalloutCodeFences`, `fixDataviewInlineQueries`
7. Result is written to a new note, appended to an existing note, or inserted/replaced inline

### Two Command Families

- **Note creation** ("Explain selection"): creates a new note from selection, replaces selection with a `[[wiki-link]]`. Uses modes from `modes.json` + custom user modes. The "Create sub-note" variant splits the selection into multiple topics, generates one note per topic into a named sub-folder of the current note's folder, and injects series instructions so the notes cross-link each other and the parent note.
- **Inline actions** ("Enhance selection"): transforms selected text in-place (expand, simplify, add examples, add diagram, summarize, challenge, fix & polish, ELI5, translate to code). Defined as `INLINE_ACTIONS` in main.ts.

### AI Provider Abstraction

Supports four backends via `settings.aiProvider`: `"claude"` (Claude Code CLI, default), `"gemini"` (Gemini CLI), `"codex"` (OpenAI Codex CLI), and `"ollama"` (local Ollama REST API). The `runClaude()` method branches on provider: Claude, Gemini, and Codex spawn CLI processes, while Ollama calls `/api/generate` via Obsidian's `requestUrl` (non-streaming; `requestUrl` cannot stream, so the live-output preview fills only for CLI providers). Claude uses `--disallowedTools` to prevent file writes; Gemini uses `--approval-mode plan`; Codex uses `codex exec --sandbox read-only` with the final message captured via `--output-last-message` written inside the plugin config folder and read back through the vault adapter (its stdout interleaves progress logs; no direct `fs` usage).

### Key Classes

- `ClaudeExplainerPlugin` (line ~2260) -- main plugin class, owns the queue, status bar, all commands
- `NoteCreatorModal` -- mode picker for note creation (multi-select, batch generation)
- `InlineActionModal` -- action picker for inline transformations
- `FullNoteActionModal`, `FillNoteModal`, `TopicGeneratorModal`, `FolderGeneratorModal`, `FolderAnalysisModal`, `NoteAnalysisModal` -- specialized generation modals
- `QueueStatusModal` -- live progress viewer with retry/remove
- `ScaleCalculatorModal`, `ScaffoldWorkspaceModal` -- batch generation utilities
- `ClaudeExplainerSettingTab` -- plugin settings UI

### Output Post-Processing

Generated content is cleaned up before writing to the vault. The fixers (lines ~565-650) handle common LLM output issues: wrapped-in-code-fence removal, mermaid block repairs, `<details>` to callout conversion, callout code fence prefix fixing, and dataview inline query escaping.

### Prompt Template Variables

Mode prompts in `modes.json` use `{selection}` and `{context}` as placeholders. These are string-replaced at enqueue time. Output formatting rules are appended after the mode prompt.

## Notes on Output Formatting Rules

The `getOutputRules()` function defines strict formatting requirements for generated notes: YAML frontmatter first, Title Case headings, no em dashes, short paragraphs, mermaid syntax constraints, Obsidian callout syntax (not HTML `<details>`). These rules are critical to Obsidian rendering compatibility.
