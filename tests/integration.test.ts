import { describe, expect, it } from "vitest";
import { runFixture } from "./helpers.js";

describe("arch check", () => {
  it("accepts local repositories and foreign services", async () => {
    const result = await runFixture("valid-basic");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No architecture violations found");
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
});
