import { spawn } from "child_process";

// Minimal typed view of the child_process surface this plugin uses. Spawning
// goes through this boundary so the rest of the code never touches untyped
// Node.js APIs directly.
export interface SpawnedCliProcess {
	stdout: { on(event: "data", callback: (data: Buffer) => void): void };
	stderr: { on(event: "data", callback: (data: Buffer) => void): void };
	stdin: { write(data: string): void; end(): void };
	on(event: "close", callback: (code: number) => void): void;
	on(event: "error", callback: (err: Error & { code?: string }) => void): void;
}

export const spawnCli = spawn as unknown as (
	command: string,
	args: string[],
	options: { shell: boolean; windowsHide: boolean }
) => SpawnedCliProcess;
