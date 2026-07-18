export const TITLE_CASE_MINOR = new Set([
	"a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so",
	"in", "on", "at", "to", "by", "of", "up", "as", "if", "is", "vs",
]);

export function toTitleCase(str: string): string {
	return str.replace(/\S+/g, (word, index) => {
		if (index === 0 || !TITLE_CASE_MINOR.has(word.toLowerCase())) {
			return word.charAt(0).toUpperCase() + word.slice(1);
		}
		return word.toLowerCase();
	});
}

export function sanitizeFilename(name: string): string {
	return toTitleCase(
		name
			.replace(/[\\/:*?"<>|]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 100)
	);
}

export function splitIntoTopics(text: string): string[] {
	const parts = text
		.split(/\r?\n|[,;]/)
		.map(p => p.replace(/^[-*•\d.)\s]+/, "").trim())
		.filter(Boolean);
	// Only treat the selection as a topic list when every part is short and
	// title-like; otherwise it is prose (e.g. a sentence with commas) and the
	// user will name the topics themselves.
	const looksLikeList = parts.length > 1 && parts.every(p => p.length <= 50 && p.split(/\s+/).length <= 6);
	return looksLikeList ? [...new Set(parts)] : [text.replace(/\s+/g, " ").trim()];
}

export function extractJsonArray(raw: string): string {
	const start = raw.indexOf("[");
	const end = raw.lastIndexOf("]");
	if (start >= 0 && end > start) {
		return raw.slice(start, end + 1);
	}
	return raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
}

export function isNoteEffectivelyEmpty(content: string): boolean {
	const stripped = content.replace(/^#\s+.*$/gm, "").trim();
	return stripped.length === 0;
}
