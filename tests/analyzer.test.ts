import { describe, expect, it } from "vitest";
import { parseSource } from "../src/analyzer.js";

describe("TypeScript dependency extraction", () => {
  it("extracts supported import forms and locations", () => {
    const parsed = parseSource(
      "example.ts",
      [
        'import DefaultExport from "./default";',
        'import { Foo as LocalFoo, type Bar } from "./named";',
        'import * as Namespace from "./namespace";',
        'import "./side-effect";',
      ].join("\n"),
    );

    expect(parsed.dependencies.map((dependency) => ({
      specifier: dependency.specifier,
      names: dependency.importedNames,
      line: dependency.line,
      column: dependency.column,
    }))).toEqual([
      { specifier: "./default", names: ["default"], line: 1, column: 1 },
      { specifier: "./named", names: ["Foo", "Bar"], line: 2, column: 1 },
      { specifier: "./namespace", names: null, line: 3, column: 1 },
      { specifier: "./side-effect", names: null, line: 4, column: 1 },
    ]);
  });

  it("preserves names across aliased and wildcard re-exports", () => {
    const parsed = parseSource(
      "index.ts",
      [
        'export { Foo as PublicFoo, type Bar } from "./named";',
        'export * from "./wildcard";',
        'export * as Namespace from "./namespace";',
      ].join("\n"),
    );

    expect(parsed.dependencies.map((dependency) => dependency.reexportMappings)).toEqual([
      [
        { exportedName: "PublicFoo", importedName: "Foo" },
        { exportedName: "Bar", importedName: "Bar" },
      ],
      [{ exportedName: null, importedName: null }],
      [{ exportedName: "Namespace", importedName: null }],
    ]);
  });

  it("reports syntax errors with a source location", () => {
    expect(() => parseSource("broken.ts", "export const value = ;")).toThrow(
      /broken\.ts:1:\d+/,
    );
  });
});
