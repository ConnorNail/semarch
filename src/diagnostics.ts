import type { FileNode, Violation } from "./types.js";

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
