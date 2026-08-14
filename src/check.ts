import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import { buildProjectGraph } from "./analyzer.js";
import { loadConfig } from "./config.js";
import { ArchitectureError, describeError } from "./errors.js";
import { ruleMatches } from "./rules.js";
import type {
  CheckResult,
  DependencyEdge,
  FileNode,
  ProjectGraph,
  Rule,
  Violation,
} from "./types.js";

export interface CheckOptions {
  projectRoot: string;
  configPath?: string;
}

export async function checkProject(options: CheckOptions): Promise<CheckResult> {
  const projectRoot = await resolveProjectRoot(options.projectRoot);
  const configPath = options.configPath === undefined
    ? path.join(projectRoot, "arch.yaml")
    : path.resolve(projectRoot, options.configPath);
  const config = await loadConfig(configPath);
  const graph = await buildProjectGraph(projectRoot, config);
  const violations = evaluateGraph(graph, config.rules);
  return { graph, violations };
}

export function evaluateGraph(
  graph: ProjectGraph,
  rules: readonly Rule[],
): readonly Violation[] {
  const violations = new Map<string, Violation>();

  for (const source of graph.files.values()) {
    for (const edge of source.dependencies) {
      if (isExternal(edge.target)) continue;

      for (const effective of effectiveTargets(edge)) {
        for (const rule of rules) {
          if (!ruleMatches(source, effective.target, rule)) continue;

          const violation: Violation = {
            source,
            target: effective.target,
            edge,
            rule,
            dependencyPath: effective.path,
          };
          const key = [
            source.path,
            edge.line,
            edge.column,
            edge.specifier,
            effective.target.path,
            rule.display,
          ].join("\0");
          const previous = violations.get(key);

          if (
            previous === undefined ||
            violation.dependencyPath.length < previous.dependencyPath.length
          ) {
            violations.set(key, violation);
          }
        }
      }
    }
  }

  return [...violations.values()].sort(compareViolations);
}

interface EffectiveTarget {
  target: FileNode;
  path: readonly FileNode[];
}

function effectiveTargets(edge: DependencyEdge): readonly EffectiveTarget[] {
  if (isExternal(edge.target)) return [];

  const results = new Map<string, EffectiveTarget>();
  addEffectiveTarget(results, [edge.source, edge.target]);

  if (edge.importedNames === null) {
    for (const dependencyPath of allExportOriginPaths(edge.target, new Set([edge.target.path]))) {
      addEveryTarget(results, [edge.source, ...dependencyPath]);
    }
  } else {
    for (const symbol of edge.importedNames) {
      for (const dependencyPath of symbolOriginPaths(
        edge.target,
        symbol,
        new Set([`${edge.target.path}\0${symbol}`]),
      )) {
        addEveryTarget(results, [edge.source, ...dependencyPath]);
      }
    }
  }

  return [...results.values()].sort((left, right) => left.target.path.localeCompare(right.target.path));
}

function symbolOriginPaths(
  module: FileNode,
  symbol: string,
  active: ReadonlySet<string>,
): readonly (readonly FileNode[])[] {
  const results: FileNode[][] = [];

  if (module.localExports.has(symbol)) results.push([module]);

  for (const edge of exportOriginsFrom(module)) {
    if (isExternal(edge.target)) continue;

    for (const mapping of edge.exportMappings) {
      if (mapping.exportedName !== null && mapping.exportedName !== symbol) continue;
      if (mapping.exportedName === null && symbol === "default") continue;

      if (mapping.importedName === null && mapping.exportedName !== null) {
        const namespacePaths = allExportOriginPaths(edge.target, new Set([edge.target.path]));
        results.push([module, edge.target]);
        for (const dependencyPath of namespacePaths) {
          results.push([module, ...dependencyPath]);
        }
        continue;
      }

      const targetSymbol = mapping.importedName ?? symbol;
      const key = `${edge.target.path}\0${targetSymbol}`;
      if (active.has(key)) continue;

      const nextActive = new Set(active);
      nextActive.add(key);
      for (const targetPath of symbolOriginPaths(edge.target, targetSymbol, nextActive)) {
        results.push([module, ...targetPath]);
      }
    }
  }

  return deduplicatePaths(results);
}

function allExportOriginPaths(
  module: FileNode,
  active: ReadonlySet<string>,
): readonly (readonly FileNode[])[] {
  const results: FileNode[][] = [];

  for (const edge of exportOriginsFrom(module)) {
    if (isExternal(edge.target) || active.has(edge.target.path)) continue;

    const directPath = [module, edge.target];
    results.push(directPath);
    const nextActive = new Set(active);
    nextActive.add(edge.target.path);

    for (const nestedPath of allExportOriginPaths(edge.target, nextActive)) {
      results.push([module, ...nestedPath]);
    }
  }

  return deduplicatePaths(results);
}

function exportOriginsFrom(file: FileNode): readonly DependencyEdge[] {
  return file.dependencies.filter((edge) => edge.exportMappings.length > 0);
}

function addEveryTarget(
  results: Map<string, EffectiveTarget>,
  dependencyPath: readonly FileNode[],
): void {
  for (let index = 1; index < dependencyPath.length; index += 1) {
    addEffectiveTarget(results, dependencyPath.slice(0, index + 1));
  }
}

function addEffectiveTarget(
  results: Map<string, EffectiveTarget>,
  dependencyPath: readonly FileNode[],
): void {
  const target = dependencyPath.at(-1);
  if (target === undefined) return;

  const previous = results.get(target.path);
  if (previous === undefined || dependencyPath.length < previous.path.length) {
    results.set(target.path, { target, path: dependencyPath });
  }
}

function deduplicatePaths(paths: readonly (readonly FileNode[])[]): readonly (readonly FileNode[])[] {
  const unique = new Map<string, readonly FileNode[]>();
  for (const dependencyPath of paths) {
    const key = dependencyPath.map((file) => file.path).join("\0");
    unique.set(key, dependencyPath);
  }
  return [...unique.values()];
}

function isExternal(value: FileNode | { kind: "external" }): value is { kind: "external" } {
  return "kind" in value && value.kind === "external";
}

function compareViolations(left: Violation, right: Violation): number {
  return (
    left.source.path.localeCompare(right.source.path) ||
    left.edge.line - right.edge.line ||
    left.edge.column - right.edge.column ||
    left.target.path.localeCompare(right.target.path) ||
    left.rule.display.localeCompare(right.rule.display)
  );
}

async function resolveProjectRoot(candidate: string): Promise<string> {
  const absolute = path.resolve(candidate);

  try {
    const info = await stat(absolute);
    if (!info.isDirectory()) throw new ArchitectureError(`Project root is not a directory: ${absolute}`);
    return await realpath(absolute);
  } catch (error) {
    if (error instanceof ArchitectureError) throw error;
    throw new ArchitectureError(`Cannot access project root ${absolute}: ${describeError(error)}`, {
      cause: error,
    });
  }
}
