import { describe, expect, it } from "vitest";
import { parseRule, ruleMatches } from "../src/rules.js";
import type { FileNode } from "../src/types.js";

describe("rules", () => {
  const components = new Set(["service", "repository", "transport"]);

  it("parses generic component names and relations", () => {
    expect(parseRule("service -> transport", components)).toMatchObject({
      sourceComponent: "service",
      targetComponent: "transport",
      domainRelation: undefined,
    });
    expect(parseRule("service -> local.repository", components)).toMatchObject({
      domainRelation: "local",
    });
  });

  it("requires domains to evaluate local and foreign relations", () => {
    const rule = parseRule("service -> foreign.repository", components);
    const source = file("users", "service");

    expect(ruleMatches(source, file("billing", "repository"), rule)).toBe(true);
    expect(ruleMatches(source, file("users", "repository"), rule)).toBe(false);
    expect(ruleMatches(source, file(undefined, "repository"), rule)).toBe(false);
  });

  it("rejects unknown components", () => {
    expect(() => parseRule("controller -> repository", components)).toThrow(
      "unknown source component",
    );
  });
});

function file(domain: string | undefined, component: string | undefined): FileNode {
  return {
    path: "file.ts",
    absolutePath: "/project/file.ts",
    domain,
    component,
    localExports: new Set(),
    dependencies: [],
  };
}
