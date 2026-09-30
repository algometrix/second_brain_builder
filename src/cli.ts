import { spawn } from "child_process";
import { homedir } from "os";

// Minimal typed view of the child_process surface this plugin uses. Spawning
// goes through this boundary so the rest of the code never touches untyped
// Node.js APIs directly. Stream chunks are typed structurally instead of as
// Buffer so the plugin compiles and lints without Node type declarations.
export interface CliOutputChunk {
	toString(): string;
}

export interface SpawnedCliProcess {
	stdout: { on(event: "data", callback: (data: CliOutputChunk) => void): void };
	stderr: { on(event: "data", callback: (data: CliOutputChunk) => void): void };
	stdin: { write(data: string): void; end(): void };
	on(event: "close", callback: (code: number) => void): void;
	on(event: "error", callback: (err: Error & { code?: string }) => void): void;
}

const spawnProcess = spawn as unknown as (
	command: string,
	args: string[],
	options: { shell: boolean; windowsHide: boolean }
) => SpawnedCliProcess;

const IS_WINDOWS = process.platform === "win32";

// cmd.exe receives the command line as one joined string, so any argument
// with whitespace, quotes, or cmd operators (& | < > ^ ( )) must be wrapped,
// with embedded quotes doubled.
function quoteForCmd(arg: string): string {
	if (arg !== "" && !/[\s"&|<>^()]/.test(arg)) return arg;
	return `"${arg.replace(/"/g, '""')}"`;
}

// Without a shell nothing expands "~", but the README recommends paths like
// ~/.nvm/versions/node/<ver>/bin/claude, so expand it here.
function expandHome(command: string): string {
	if (command === "~") return homedir();
	if (command.startsWith("~/")) return homedir() + command.slice(1);
	return command;
}

/**
 * Spawns an AI CLI with every argument delivered to it intact, even when an
 * argument contains spaces (a vault under "~/Library/Mobile Documents", or the
 * system prompt text).
 *
 * Windows needs a shell to run the npm `.cmd` shims the CLIs install as, so
 * arguments are quoted for cmd.exe. Everywhere else no shell is used, which
 * passes arguments to the CLI verbatim with no word splitting.
 */
export function spawnCli(command: string, args: string[]): SpawnedCliProcess {
	if (IS_WINDOWS) {
		return spawnProcess(quoteForCmd(command), args.map(quoteForCmd), {
			shell: true,
			windowsHide: true,
		});
	}
	return spawnProcess(expandHome(command), args, {
		shell: false,
		windowsHide: true,
	});
}
