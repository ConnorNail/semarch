import { describe, expect, it } from "vitest";
import { runCli, VERSION } from "../src/cli.js";

describe("CLI argument handling", () => {
  it("prints help and version", async () => {
    const output: string[] = [];
    const io = { stdout: (message: string) => output.push(message), stderr: () => undefined };

    await expect(runCli(["--help"], io)).resolves.toBe(0);
    await expect(runCli(["--version"], io)).resolves.toBe(0);
    expect(output.join("\n")).toContain("semarch check [project-root]");
    expect(output.join("\n")).toContain("semarch inspect <file>");
    expect(output).toContain(VERSION);
  });

  it("rejects unknown commands and options", async () => {
    const errors: string[] = [];
    const io = { stdout: () => undefined, stderr: (message: string) => errors.push(message) };

    await expect(runCli(["unknown"], io)).resolves.toBe(2);
    await expect(runCli(["check", "--json"], io)).resolves.toBe(2);
    expect(errors.join("\n")).toContain("Unknown option");
  });

  it("requires an inspected file", async () => {
    const errors: string[] = [];
    const io = { stdout: () => undefined, stderr: (message: string) => errors.push(message) };

    await expect(runCli(["inspect"], io)).resolves.toBe(2);
    expect(errors.join("\n")).toContain("inspect requires a file path");
  });
});
