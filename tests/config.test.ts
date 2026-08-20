import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { discoverAndClassifyFiles } from "../src/project.js";

const baseConfig = `version: 1
domains:
  users:
    root: src/users
components:
  service:
    match: ["**/services/**/*.ts"]
  repository:
    match: ["**/repositories/**/*.ts"]
rules:
  - deny: service -> foreign.repository
`;

describe("configuration", () => {
  it("loads defaults and normalizes deny rules", async () => {
    const directory = await temporaryProject({ "arch.yaml": baseConfig });
    const config = await loadConfig(path.join(directory, "arch.yaml"));

    expect(config.include).toEqual(["src/**/*.{ts,tsx}"]);
    expect(config.exclude).toContain("**/node_modules/**");
    expect(config.rules).toEqual([
      {
        sourceComponent: "service",
        targetComponent: "repository",
        domainRelation: "foreign",
        display: "service -> foreign.repository",
      },
    ]);
  });

  it("allows domains to be omitted or empty for component-only rules", async () => {
    const componentOnlyConfig = baseConfig.replace(
      "domains:\n  users:\n    root: src/users\n",
      "",
    ).replace("foreign.repository", "repository");

    for (const source of [componentOnlyConfig, `domains: {}\n${componentOnlyConfig}`]) {
      const directory = await temporaryProject({ "arch.yaml": source });
      const config = await loadConfig(path.join(directory, "arch.yaml"));

      expect(config.domains).toEqual([]);
    }
  });

  it("rejects relational rules when no domains are configured", async () => {
    const directory = await temporaryProject({
      "arch.yaml": baseConfig.replace(
        "domains:\n  users:\n    root: src/users\n",
        "",
      ),
    });

    await expect(loadConfig(path.join(directory, "arch.yaml"))).rejects.toThrow(
      'Rule "service -> foreign.repository" uses a domain relation, but no domains are configured.',
    );
  });

  it("rejects overlapping domain roots", async () => {
    const directory = await temporaryProject({
      "arch.yaml": baseConfig.replace(
        "  users:\n    root: src/users",
        "  users:\n    root: src\n  billing:\n    root: src/billing",
      ),
    });

    await expect(loadConfig(path.join(directory, "arch.yaml"))).rejects.toThrow(
      "Domain roots overlap",
    );
  });

  it("rejects glob patterns in a domain root", async () => {
    const directory = await temporaryProject({
      "arch.yaml": baseConfig.replace("root: src/users", 'root: "src/**/user.*.ts"'),
    });

    await expect(loadConfig(path.join(directory, "arch.yaml"))).rejects.toThrow(
      'root must be a literal directory path, not a glob. Use "match"',
    );
  });

  it("classifies domains with glob matches", async () => {
    const directory = await temporaryProject({
      "arch.yaml": baseConfig.replace(
        "root: src/users",
        'match: ["src/**/user.*.ts"]',
      ),
      "src/services/user.service.ts": "export class UserService {}\n",
    });
    const config = await loadConfig(path.join(directory, "arch.yaml"));
    const files = await discoverAndClassifyFiles(directory, config);

    expect(files).toHaveLength(1);
    expect(files[0]?.domain).toBe("users");
  });

  it("rejects files matching multiple domain patterns", async () => {
    const configText = baseConfig.replace(
      "  users:\n    root: src/users",
      [
        "  users:",
        '    match: ["src/**/*.ts"]',
        "  billing:",
        '    match: ["src/**/user.*.ts"]',
      ].join("\n"),
    );
    const directory = await temporaryProject({
      "arch.yaml": configText,
      "src/services/user.service.ts": "export class UserService {}\n",
    });
    const config = await loadConfig(path.join(directory, "arch.yaml"));

    await expect(discoverAndClassifyFiles(directory, config)).rejects.toThrow(
      "matches multiple domains",
    );
  });

  it("rejects unknown fields and duplicate YAML keys", async () => {
    const unknownDirectory = await temporaryProject({
      "arch.yaml": `${baseConfig}unexpected: true\n`,
    });
    const duplicateDirectory = await temporaryProject({
      "arch.yaml": baseConfig.replace("version: 1", "version: 1\nversion: 1"),
    });

    await expect(loadConfig(path.join(unknownDirectory, "arch.yaml"))).rejects.toThrow(
      "Unrecognized key",
    );
    await expect(loadConfig(path.join(duplicateDirectory, "arch.yaml"))).rejects.toThrow(
      "Map keys must be unique",
    );
  });

  it("rejects files matching multiple component categories", async () => {
    const configText = baseConfig.replace(
      "match: [\"**/repositories/**/*.ts\"]",
      "match: [\"**/services/**/*.ts\"]",
    );
    const directory = await temporaryProject({
      "arch.yaml": configText,
      "src/users/services/user.ts": "export class UserService {}\n",
    });
    const config = await loadConfig(path.join(directory, "arch.yaml"));

    await expect(discoverAndClassifyFiles(directory, config)).rejects.toThrow(
      "matches multiple components",
    );
  });
});

async function temporaryProject(files: Readonly<Record<string, string>>): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "arch-config-test-"));

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(directory, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
  }

  return directory;
}
