import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { fixturePath, runFixture } from "./helpers.js";

describe("semarch check", () => {
  it("enforces component rules without configured domains", async () => {
    const result = await runFixture("component-only");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("job -> repository");
    expect(result.stdout).toContain("domains: not configured");
    expect(result.stderr).toBe("");
  });

  it("accepts local repositories and foreign services", async () => {
    const result = await runFixture("valid-basic");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No architecture violations found");
    expect(result.stdout).toContain("files: 5");
    expect(result.stdout).toContain("fully unclassified: 0");
    expect(result.stderr).toBe("");
  });

  it("reports foreign repository access with both domains", async () => {
    const result = await runFixture("foreign-repository");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("src/users/services/user.service.ts:1:1");
    expect(result.stdout).toContain("users.service");
    expect(result.stdout).toContain("billing.repository");
    expect(result.stdout).toContain("service -> foreign.repository");
    expect(result.stderr).toBe("");
  });

  it("reports service to transport dependencies", async () => {
    const result = await runFixture("transport-import");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("service -> transport");
    expect(result.stdout).toContain("transport");
  });

  it("follows the imported symbol through a barrel", async () => {
    const result = await runFixture("barrel-reexport");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Dependency path:");
    expect(result.stdout).toContain("src/billing/index.ts");
    expect(result.stdout).toContain("src/billing/repositories/billing.repository.ts");
  });

  it("does not follow unrelated symbols exported by a barrel", async () => {
    const result = await runFixture("allowed-barrel-symbol");

    expect(result.exitCode).toBe(0);
  });

  it("handles wildcard re-export cycles without losing the terminal dependency", async () => {
    const result = await runFixture("barrel-cycle");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("src/billing/repositories/billing.repository.ts");
  });

  it("ignores external packages", async () => {
    const result = await runFixture("external-package");

    expect(result.exitCode).toBe(0);
  });

  it("uses exit code 2 for unresolved relative imports", async () => {
    const result = await runFixture("unresolved-import");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Cannot resolve relative import");
  });

  it("rejects project-local TypeScript imports excluded from analysis", async () => {
    const result = await runFixture("excluded-internal");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("resolves to internal file");
    expect(result.stderr).toContain("excluded from analysis");
  });

  it("rejects unresolved imports matching a configured tsconfig alias", async () => {
    const result = await runFixture("unresolved-alias");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Cannot resolve configured path alias "@app/repositories/missing.repository"');
  });

  it("resolves tsconfig aliases and distinguishes repositories from a shared provider", async () => {
    const result = await runFixture("shared-repository-provider");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Architecture violations (2)");
    expect(result.stdout).toContain("billing.repository");
    expect(result.stdout).toContain("inventory.repository");
    expect(result.stdout).not.toContain("Target:\n  path: src/repositories/user.repository.ts");
    expect(result.stdout).toContain(
      "src/services/users/user.service.ts\n  -> src/repositories/repository-provider.ts",
    );
    expect(result.stderr).toBe("");
  });

  it("inspects classifications, resolution, provenance, and matching violations", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      [
        "inspect",
        "src/services/users/user.service.ts",
        "--root",
        fixturePath("shared-repository-provider"),
      ],
      {
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
    );
    const output = stdout.join("\n");

    expect(exitCode).toBe(0);
    expect(output).toContain("Domain: users");
    expect(output).toContain("resolution: internal");
    expect(output).toContain("userRepository:");
    expect(output).toContain("src/repositories/user.repository.ts");
    expect(output).toContain(
      "service -> foreign.repository -> src/repositories/inventory.repository.ts",
    );
    expect(stderr).toEqual([]);
  });
});
