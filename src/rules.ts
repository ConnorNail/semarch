import { ArchitectureError } from "./errors.js";
import type { FileNode, Rule } from "./types.js";

const RULE_PATTERN =
  /^([A-Za-z][A-Za-z0-9_-]*)\s*->\s*(?:(local|foreign)\.)?([A-Za-z][A-Za-z0-9_-]*)$/;

export function parseRule(expression: string, components: ReadonlySet<string>): Rule {
  const match = RULE_PATTERN.exec(expression.trim());

  if (match === null) {
    throw new ArchitectureError(
      `Invalid deny rule "${expression}". Expected "component -> component" or "component -> local|foreign.component".`,
    );
  }

  const sourceComponent = match[1];
  const relation = match[2];
  const targetComponent = match[3];

  if (sourceComponent === undefined || targetComponent === undefined) {
    throw new ArchitectureError(`Invalid deny rule "${expression}".`);
  }

  if (!components.has(sourceComponent)) {
    throw new ArchitectureError(
      `Rule "${expression}" references unknown source component "${sourceComponent}".`,
    );
  }

  if (!components.has(targetComponent)) {
    throw new ArchitectureError(
      `Rule "${expression}" references unknown target component "${targetComponent}".`,
    );
  }

  const domainRelation = relation === "local" || relation === "foreign" ? relation : undefined;
  const target = domainRelation
    ? `${domainRelation}.${targetComponent}`
    : targetComponent;

  return {
    sourceComponent,
    targetComponent,
    domainRelation,
    display: `${sourceComponent} -> ${target}`,
  };
}

export function ruleMatches(source: FileNode, target: FileNode, rule: Rule): boolean {
  if (
    source.component !== rule.sourceComponent ||
    target.component !== rule.targetComponent
  ) {
    return false;
  }

  if (rule.domainRelation === undefined) {
    return true;
  }

  if (source.domain === undefined || target.domain === undefined) {
    return false;
  }

  return rule.domainRelation === "local"
    ? source.domain === target.domain
    : source.domain !== target.domain;
}
