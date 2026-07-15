export const LOG_PREFIX = "[Second Brain Builder]";
export const MAX_LOG_LINES = 500;

export class Logger {
	private lines: string[] = [];
	private enabled = true;

	setEnabled(enabled: boolean) { this.enabled = enabled; }

	info(msg: string, ...data: unknown[]) {
		if (!this.enabled) return;
		const entry = `${this.timestamp()} INFO  ${msg}`;
		this.lines.push(entry);
		console.debug(LOG_PREFIX, msg, ...data);
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

export const logger = new Logger();
