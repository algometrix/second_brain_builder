import { spawn } from "child_process";

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

export const spawnCli = spawn as unknown as (
	command: string,
	args: string[],
	options: { shell: boolean; windowsHide: boolean }
) => SpawnedCliProcess;
