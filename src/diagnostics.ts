import type { InspectionResult } from "./check.js";
import type {
  ExternalModule,
  FileNode,
  ProjectGraph,
  Violation,
} from "./types.js";

export function formatViolations(violations: readonly Violation[]): string {
  const heading = violations.length === 1
    ? "Architecture violation"
    : `Architecture violations (${violations.length})`;
  const details = violations.map((violation, index) => {
    const number = violations.length > 1 ? `[${index + 1}/${violations.length}]\n` : "";
    return `${number}${formatViolation(violation)}`;
  });
  return [heading, ...details].join("\n\n");
}

export function formatViolation(violation: Violation): string {
  const sourceClassification = classification(violation.source);
  const targetClassification = classification(violation.target);
  const sections = [
    `${violation.source.path}:${violation.edge.line}:${violation.edge.column}`,
    "Forbidden architecture dependency",
    `${sourceClassification}\n  ↓\n${targetClassification}`,
    `Import:\n  ${violation.edge.specifier}`,
    `Rule:\n  ${violation.rule.display}`,
    [
      "Source:",
      `  path: ${violation.source.path}`,
      `  domain: ${violation.source.domain ?? "unclassified"}`,
      `  component: ${violation.source.component ?? "unclassified"}`,
    ].join("\n"),
    [
      "Target:",
      `  path: ${violation.target.path}`,
      `  domain: ${violation.target.domain ?? "unclassified"}`,
      `  component: ${violation.target.component ?? "unclassified"}`,
    ].join("\n"),
  ];

  if (violation.dependencyPath.length > 2) {
    sections.push(
      `Dependency path:\n  ${violation.dependencyPath.map((file) => file.path).join("\n  -> ")}`,
    );
  }

  const suggestion = suggestionFor(violation);
  if (suggestion !== undefined) sections.push(`Suggestion:\n  ${suggestion}`);

  return sections.join("\n\n");
}

export function formatClassificationSummary(graph: ProjectGraph): string {
  const files = [...graph.files.values()];
  const withoutDomain = files.filter((file) => file.domain === undefined).length;
  const withoutComponent = files.filter((file) => file.component === undefined).length;
  const fullyUnclassified = files.filter(
    (file) => file.domain === undefined && file.component === undefined,
  ).length;

  return [
    "Classification:",
    `  files: ${files.length}`,
    `  without domain: ${withoutDomain}`,
    `  without component: ${withoutComponent}`,
    `  fully unclassified: ${fullyUnclassified}`,
  ].join("\n");
}

export function formatInspection(result: InspectionResult): string {
  const sections = [
    [
      `File: ${result.file.path}`,
      `Domain: ${result.file.domain ?? "unclassified"}`,
      `Component: ${result.file.component ?? "unclassified"}`,
    ].join("\n"),
  ];

  if (result.dependencies.length === 0) {
    sections.push("Dependencies: none");
    return sections.join("\n\n");
  }

  const dependencies = result.dependencies.map(({ edge, origins }, index) => {
    const target = edge.target;
    const lines = [
      `[${index + 1}/${result.dependencies.length}] ${edge.line}:${edge.column} ${edge.kind} ${edge.specifier}`,
    ];

    if (isExternalModule(target)) {
      lines.push("  resolution: external");
      return lines.join("\n");
    }

    lines.push(
      "  resolution: internal",
      `  target: ${target.path}`,
      `  target domain: ${target.domain ?? "unclassified"}`,
      `  target component: ${target.component ?? "unclassified"}`,
      `  imported symbols: ${edge.importedNames?.join(", ") ?? "all exports"}`,
    );

    if (origins.length > 0) {
      lines.push("  provenance:");
      for (const origin of origins) {
        lines.push(
          `    ${origin.symbol ?? "all exports"}:`,
          `      ${origin.path.map((file) => file.path).join("\n      -> ")}`,
        );
      }
    }

    const violations = result.violations.filter((violation) => violation.edge === edge);
    if (violations.length > 0) {
      lines.push("  violations:");
      for (const violation of violations) {
        lines.push(`    ${violation.rule.display} -> ${violation.target.path}`);
      }
    }

    return lines.join("\n");
  });

  sections.push(`Dependencies (${result.dependencies.length})\n\n${dependencies.join("\n\n")}`);
  return sections.join("\n\n");
}

function classification(file: FileNode): string {
  if (file.domain !== undefined && file.component !== undefined) {
    return `${file.domain}.${file.component}`;
  }
  return file.component ?? file.domain ?? "unclassified";
}

function suggestionFor(violation: Violation): string | undefined {
  if (
    violation.rule.domainRelation === "foreign" &&
    violation.rule.targetComponent === "repository"
  ) {
    return `Depend on the ${violation.target.domain ?? "target"} domain's service or public API instead of its repository.`;
  }
  return undefined;
}

function isExternalModule(
  value: FileNode | ExternalModule,
): value is ExternalModule {
  return "kind" in value && value.kind === "external";
}
