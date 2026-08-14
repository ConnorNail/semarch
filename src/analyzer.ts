import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { ArchitectureError, describeError } from "./errors.js";
import { discoverAndClassifyFiles } from "./project.js";
import type {
  ArchitectureConfig,
  DependencyEdge,
  ExternalModule,
  FileNode,
  ProjectGraph,
  ReexportMapping,
} from "./types.js";

export interface ParsedDependency {
  kind: "import" | "reexport";
  specifier: string;
  line: number;
  column: number;
  importedNames: readonly string[] | null;
  reexportMappings: readonly ReexportMapping[];
}

export interface ParsedSource {
  localExports: ReadonlySet<string>;
  dependencies: readonly ParsedDependency[];
}

const compilerOptions: ts.CompilerOptions = {
  allowJs: false,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
};

export async function buildProjectGraph(
  projectRoot: string,
  config: ArchitectureConfig,
): Promise<ProjectGraph> {
  const files = await discoverAndClassifyFiles(projectRoot, config);
  const parsedFiles = await Promise.all(
    files.map(async (file) => {
      let source: string;

      try {
        source = await readFile(file.absolutePath, "utf8");
      } catch (error) {
        throw new ArchitectureError(
          `Cannot read source file ${file.path}: ${describeError(error)}`,
          { cause: error },
        );
      }

      return { file, parsed: parseSource(file.path, source) };
    }),
  );

  const nodes = new Map<string, FileNode>();

  for (const { file, parsed } of parsedFiles) {
    nodes.set(file.path, {
      ...file,
      localExports: parsed.localExports,
      dependencies: [],
    });
  }

  for (const { file, parsed } of parsedFiles) {
    const sourceNode = nodes.get(file.path);
    if (sourceNode === undefined) {
      throw new ArchitectureError(`Internal error: missing graph node for ${file.path}.`);
    }

    for (const dependency of parsed.dependencies) {
      const target = resolveDependency(
        dependency.specifier,
        file.absolutePath,
        projectRoot,
        nodes,
      );

      const edge: DependencyEdge = {
        ...dependency,
        source: sourceNode,
        target,
      };
      sourceNode.dependencies.push(edge);
    }
  }

  return { root: projectRoot, files: nodes };
}

export function parseSource(filePath: string, source: string): ParsedSource {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    false,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics ?? [];

  if (parseDiagnostics.length > 0) {
    const messages = parseDiagnostics.map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (diagnostic.start === undefined) return `  - ${message}`;
      const location = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
      return `  - ${filePath}:${location.line + 1}:${location.character + 1}: ${message}`;
    });
    throw new ArchitectureError(`TypeScript syntax error:\n${messages.join("\n")}`);
  }

  const dependencies: ParsedDependency[] = [];
  const localExports = new Set<string>();

  for (const statement of sourceFile.statements) {
    collectLocalExports(statement, localExports);

    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      dependencies.push({
        kind: "import",
        specifier: statement.moduleSpecifier.text,
        ...sourceLocation(sourceFile, statement),
        importedNames: importedNames(statement.importClause),
        reexportMappings: [],
      });
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      const mappings = reexportMappings(statement.exportClause);
      dependencies.push({
        kind: "reexport",
        specifier: statement.moduleSpecifier.text,
        ...sourceLocation(sourceFile, statement),
        importedNames: namesRequestedByReexport(mappings),
        reexportMappings: mappings,
      });
    }
  }

  return { localExports, dependencies };
}

function importedNames(importClause: ts.ImportClause | undefined): readonly string[] | null {
  if (importClause === undefined) return null;

  const names: string[] = [];
  if (importClause.name !== undefined) names.push("default");

  const bindings = importClause.namedBindings;
  if (bindings === undefined) return names;
  if (ts.isNamespaceImport(bindings)) return null;

  for (const element of bindings.elements) {
    names.push((element.propertyName ?? element.name).text);
  }

  return [...new Set(names)];
}

function reexportMappings(
  exportClause: ts.NamedExportBindings | undefined,
): readonly ReexportMapping[] {
  if (exportClause === undefined) {
    return [{ exportedName: null, importedName: null }];
  }

  if (ts.isNamespaceExport(exportClause)) {
    return [{ exportedName: exportClause.name.text, importedName: null }];
  }

  return exportClause.elements.map((element) => ({
    exportedName: element.name.text,
    importedName: (element.propertyName ?? element.name).text,
  }));
}

function namesRequestedByReexport(
  mappings: readonly ReexportMapping[],
): readonly string[] | null {
  if (mappings.some((mapping) => mapping.importedName === null)) return null;
  return [...new Set(mappings.flatMap((mapping) => mapping.importedName ?? []))];
}

function collectLocalExports(statement: ts.Statement, exports: Set<string>): void {
  if (ts.isExportAssignment(statement)) {
    exports.add("default");
    return;
  }

  if (ts.isExportDeclaration(statement)) {
    if (statement.moduleSpecifier === undefined && statement.exportClause !== undefined) {
      if (ts.isNamespaceExport(statement.exportClause)) {
        exports.add(statement.exportClause.name.text);
      } else {
        for (const element of statement.exportClause.elements) exports.add(element.name.text);
      }
    }
    return;
  }

  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return;

  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
    exports.add("default");
    return;
  }

  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNames(declaration.name, exports);
    }
    return;
  }

  if (
    (ts.isClassDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)) &&
    statement.name !== undefined
  ) {
    exports.add(statement.name.text);
  }
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, names);
  }
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function sourceLocation(sourceFile: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: location.line + 1, column: location.character + 1 };
}

function resolveDependency(
  specifier: string,
  containingFile: string,
  projectRoot: string,
  nodes: ReadonlyMap<string, FileNode>,
): FileNode | ExternalModule {
  if (!isRelativeSpecifier(specifier)) return externalModule(specifier);

  const result = ts.resolveModuleName(specifier, containingFile, compilerOptions, ts.sys);
  const resolved = result.resolvedModule;

  if (resolved === undefined) {
    const sourcePath = toProjectPath(projectRoot, containingFile) ?? containingFile;
    throw new ArchitectureError(
      `Cannot resolve relative import "${specifier}" from ${sourcePath}.`,
    );
  }

  const targetPath = toProjectPath(projectRoot, resolved.resolvedFileName);
  if (
    targetPath === undefined ||
    targetPath.split("/").includes("node_modules") ||
    resolved.isExternalLibraryImport === true
  ) {
    return externalModule(specifier);
  }

  return nodes.get(targetPath) ?? externalModule(specifier);
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function toProjectPath(projectRoot: string, absolutePath: string): string | undefined {
  const relative = path.relative(projectRoot, path.resolve(absolutePath));
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join("/");
}

function externalModule(specifier: string): ExternalModule {
  return { kind: "external", specifier };
}
