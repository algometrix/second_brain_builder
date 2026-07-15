export function getOutputRules(): string {
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

export const INLINE_OUTPUT_RULES = `

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

export const APPEND_OUTPUT_RULES = `

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
