export function fixCodeBlocks(content: string): string {
	return content.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang: string, inner: string) => {
		const fixed = inner.replace(/\\n/g, "\n");
		const ending = fixed.endsWith("\n") ? "" : "\n";
		return "```" + lang + "\n" + fixed + ending + "```";
	});
}

export function fixMermaidBlocks(content: string): string {
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
		fixed = fixed.replace(/\[([^\]"]*[()/\\][^\]"]*)\]/g, '["$1"]');
		fixed = fixed.replace(/\(([^)"]*[()][^)"]*)\)/g, '("$1")');
		if (!fixed.endsWith("\n")) fixed += "\n";
		return "```mermaid\n" + fixed + "```";
	});
}

export function fixDetailsBlocks(content: string): string {
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

export function fixCalloutCodeFences(content: string): string {
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

export function fixCurrencyDollars(content: string): string {
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

export function fixDataviewInlineQueries(content: string): string {
	// Dataview treats `= expression` (backtick-equals) as inline queries.
	// Escape by inserting a zero-width space after the opening backtick.
	return content.replace(/`(=\s)/g, "`​$1");
}
