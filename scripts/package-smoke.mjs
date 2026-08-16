import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageMetadata = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "semarch-package-smoke-"));

try {
  const packResult = run(
    "npm",
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      temporaryRoot,
      "--cache",
      path.join(temporaryRoot, "npm-cache"),
    ],
    packageRoot,
  );
  const packedPackages = JSON.parse(packResult.stdout);
  const packedPackage = packedPackages[0];

  assert.equal(packedPackage.name, packageMetadata.name);
  assert.equal(packedPackage.version, packageMetadata.version);

  const packedFiles = new Set(packedPackage.files.map((file) => file.path));
  assert(packedFiles.has("dist/index.js"), "Package must contain dist/index.js.");
  assert(packedFiles.has("README.md"), "Package must contain README.md.");
  assert(
    [...packedFiles].every((file) => !file.startsWith("src/") && !file.startsWith("tests/")),
    "Package must not contain source or test files.",
  );

  const consumer = path.join(temporaryRoot, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    path.join(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "semarch-smoke-consumer",
        private: true,
      },
      null,
      2,
    )}\n`,
  );

  const tarball = path.join(temporaryRoot, packedPackage.filename);
  const npmCache = path.join(temporaryRoot, "npm-cache");
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      npmCache,
      "--save-dev",
      tarball,
    ],
    consumer,
  );

  const version = run("npm", ["exec", "--", "semarch", "--version"], consumer);
  assert.equal(version.stdout.trim(), packageMetadata.version);

  const help = run("npm", ["exec", "--", "semarch", "--help"], consumer);
  assert.match(help.stdout, /semarch check \[project-root\]/);

  const validFixture = path.join(packageRoot, "tests", "fixtures", "valid-basic");
  const check = run("npm", ["exec", "--", "semarch", "check", validFixture], consumer);
  assert.match(check.stdout, /No architecture violations found/);

  console.log(`Package smoke test passed for ${packageMetadata.name}@${packageMetadata.version}.`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  });

  if (result.error !== undefined) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed.\n\n${result.stdout}${result.stderr}`,
  );
  return result;
}
