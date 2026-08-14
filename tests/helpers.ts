import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, type CliIO } from "../src/cli.js";

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));

export function fixturePath(name: string): string {
  return path.join(testsDirectory, "fixtures", name);
}

export async function runFixture(name: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIO = {
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  };
  const exitCode = await runCli(["check", fixturePath(name)], io);
  return { exitCode, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}
