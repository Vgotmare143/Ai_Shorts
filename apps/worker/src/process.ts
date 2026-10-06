import { spawn } from "node:child_process";

export interface ProcessResult {
  code: number;
  stderr: string; // last 4000 characters only
}

export interface ProcessOptions {
  cwd?: string;
}

export function runProcess(command: string, args: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, cwd: options.cwd });
    let stderr = "";
    child.stdout.on("data", () => {}); // drain so the process never blocks
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}