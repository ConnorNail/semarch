import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const project = mkdtempSync(path.join(tmpdir(), "arch-benchmark-"));
const sourceDirectory = path.join(project, "src", "example", "services");

try {
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(
    path.join(project, "arch.yaml"),
    `version: 1
include: ["src/**/*.ts"]
domains:
  example:
    root: src/example
components:
  service:
    match: ["**/services/**/*.ts"]
rules: []
`,
  );

  for (let index = 0; index < 1_000; index += 1) {
    const previousImport = index === 0
      ? ""
      : `import { value as previous } from "./file-${index - 1}";\n`;
    const expression = index === 0 ? "0" : "previous + 1";
    writeFileSync(
      path.join(sourceDirectory, `file-${index}.ts`),
      `${previousImport}export const value = ${expression};\n`,
    );
  }

  const start = performance.now();
  execFileSync(process.execPath, ["dist/index.js", "check", project], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  const elapsed = performance.now() - start;
  console.log(`Checked 1,000 TypeScript files in ${elapsed.toFixed(0)}ms`);
  if (elapsed > 2_000) console.warn("Prototype performance target exceeded (2,000ms).");
} finally {
  rmSync(project, { recursive: true, force: true });
}
