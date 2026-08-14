import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import { ArchitectureError, describeError } from "./errors.js";
import { parseRule } from "./rules.js";
import type {
  ArchitectureConfig,
  ComponentDefinition,
  DomainDefinition,
} from "./types.js";

const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]*$/,
    "must start with a letter and contain only letters, numbers, underscores, or hyphens",
  );

const nonEmptyString = z.string().trim().min(1);

const rawConfigSchema = z
  .object({
    version: z.literal(1),
    include: z.array(nonEmptyString).min(1).optional(),
    exclude: z.array(nonEmptyString).optional(),
    domains: z
      .record(identifierSchema, z.object({ root: nonEmptyString }).strict())
      .refine((value) => Object.keys(value).length > 0, "must define at least one domain"),
    components: z
      .record(
        identifierSchema,
        z.object({ match: z.array(nonEmptyString).min(1) }).strict(),
      )
      .refine(
        (value) => Object.keys(value).length > 0,
        "must define at least one component",
      ),
    rules: z.array(z.object({ deny: nonEmptyString }).strict()),
  })
  .strict();

const DEFAULT_INCLUDE = ["src/**/*.{ts,tsx}"] as const;
const NODE_MODULES_EXCLUDE = "**/node_modules/**";

export async function loadConfig(configPath: string): Promise<ArchitectureConfig> {
  let source: string;

  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ArchitectureError(
      `Cannot read configuration at ${configPath}: ${describeError(error)}`,
      { cause: error },
    );
  }

  const document = parseDocument(source, {
    prettyErrors: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    throw new ArchitectureError(
      `Invalid YAML in ${configPath}:\n${document.errors.map((error) => `  - ${error.message}`).join("\n")}`,
    );
  }

  const parsed = rawConfigSchema.safeParse(document.toJS());

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const location = issue.path.length > 0 ? issue.path.join(".") : "configuration";
        return `  - ${location}: ${issue.message}`;
      })
      .join("\n");
    throw new ArchitectureError(`Invalid configuration in ${configPath}:\n${issues}`);
  }

  const domains = Object.entries(parsed.data.domains)
    .map(([name, value]): DomainDefinition => ({
      name,
      root: normalizeProjectPath(value.root, `domain "${name}" root`),
    }))
    .sort(compareByName);

  assertNonOverlappingDomains(domains);

  const components = Object.entries(parsed.data.components)
    .map(([name, value]): ComponentDefinition => ({
      name,
      match: value.match.map((pattern) => normalizeGlob(pattern, `component "${name}"`)),
    }))
    .sort(compareByName);

  const componentNames = new Set(components.map((component) => component.name));
  const rules = parsed.data.rules.map(({ deny }) => parseRule(deny, componentNames));
  const include = (parsed.data.include ?? DEFAULT_INCLUDE).map((pattern) =>
    normalizeGlob(pattern, "include"),
  );
  const configuredExclude = (parsed.data.exclude ?? []).map((pattern) =>
    normalizeGlob(pattern, "exclude"),
  );
  const exclude = [...new Set([...configuredExclude, NODE_MODULES_EXCLUDE])];

  return {
    version: 1,
    include,
    exclude,
    domains,
    components,
    rules,
  };
}

function normalizeProjectPath(value: string, label: string): string {
  const portable = value.replaceAll("\\", "/");

  if (path.posix.isAbsolute(portable) || path.win32.isAbsolute(portable)) {
    throw new ArchitectureError(`The ${label} must be relative to the project root.`);
  }

  const normalized = path.posix.normalize(portable).replace(/^\.\//, "").replace(/\/$/, "");

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new ArchitectureError(`The ${label} cannot escape the project root.`);
  }

  return normalized || ".";
}

function normalizeGlob(value: string, label: string): string {
  const portable = value.replaceAll("\\", "/");

  if (
    path.posix.isAbsolute(portable) ||
    path.win32.isAbsolute(portable) ||
    portable.split("/").includes("..")
  ) {
    throw new ArchitectureError(`The ${label} glob "${value}" must stay within the project root.`);
  }

  return portable.replace(/^\.\//, "");
}

function assertNonOverlappingDomains(domains: readonly DomainDefinition[]): void {
  for (let leftIndex = 0; leftIndex < domains.length; leftIndex += 1) {
    const left = domains[leftIndex];
    if (left === undefined) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < domains.length; rightIndex += 1) {
      const right = domains[rightIndex];
      if (right === undefined) continue;

      if (containsPath(left.root, right.root) || containsPath(right.root, left.root)) {
        throw new ArchitectureError(
          `Domain roots overlap: "${left.name}" (${left.root}) and "${right.name}" (${right.root}).`,
        );
      }
    }
  }
}

function containsPath(parent: string, child: string): boolean {
  return parent === "." || child === parent || child.startsWith(`${parent}/`);
}

function compareByName<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name);
}
