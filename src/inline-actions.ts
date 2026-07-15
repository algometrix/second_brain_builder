import { InlineAction } from "./types";

export const INLINE_ACTIONS: InlineAction[] = [
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
