import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { ArchitectureError, describeError } from "./errors.js";
import { discoverAndClassifyFiles } from "./project.js";
import type {
  ArchitectureConfig,
  DependencyEdge,
  ExternalModule,
  ExportMapping,
  FileNode,
  ProjectGraph,
} from "./types.js";

export interface ParsedDependency {
  kind: "import" | "reexport";
  specifier: string;
  line: number;
  column: number;
  importedNames: readonly string[] | null;
  exportMappings: readonly ExportMapping[];
}

export interface ParsedSource {
  localExports: ReadonlySet<string>;
  dependencies: readonly ParsedDependency[];
}

interface MutableParsedDependency extends ParsedDependency {
  exportMappings: ExportMapping[];
}

interface ImportedBinding {
  localName: string;
  importedName: string;
}

interface ParsedImports {
  importedNames: readonly string[] | null;
  bindings: readonly ImportedBinding[];
}

interface InitializerCandidate {
  exportedName: string;
  localName: string;
}

const defaultCompilerOptions: ts.CompilerOptions = {
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
  const compilerOptions = loadProjectCompilerOptions(projectRoot);
  const moduleResolutionCache = ts.createModuleResolutionCache(
    projectRoot,
    ts.sys.useCaseSensitiveFileNames ? (value) => value : (value) => value.toLowerCase(),
    compilerOptions,
  );
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
        compilerOptions,
        moduleResolutionCache,
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

  const dependencies: MutableParsedDependency[] = [];
  const localExports = new Set<string>();
  const importedBindings = new Map<
    string,
    { dependency: MutableParsedDependency; importedName: string }
  >();
  const initializerCandidates: InitializerCandidate[] = [];

  for (const statement of sourceFile.statements) {
    collectLocalExports(statement, localExports);
    initializerCandidates.push(...collectInitializerCandidates(statement));

    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const parsedImports = parseImports(statement.importClause);
      const dependency: MutableParsedDependency = {
        kind: "import",
        specifier: statement.moduleSpecifier.text,
        ...sourceLocation(sourceFile, statement),
        importedNames: parsedImports.importedNames,
        exportMappings: [],
      };
      dependencies.push(dependency);

      for (const binding of parsedImports.bindings) {
        importedBindings.set(binding.localName, {
          dependency,
          importedName: binding.importedName,
        });
      }
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      const mappings = exportMappings(statement.exportClause);
      dependencies.push({
        kind: "reexport",
        specifier: statement.moduleSpecifier.text,
        ...sourceLocation(sourceFile, statement),
        importedNames: namesRequestedByReexport(mappings),
        exportMappings: [...mappings],
      });
    }
  }

  for (const candidate of initializerCandidates) {
    const origin = importedBindings.get(candidate.localName);
    if (origin === undefined) continue;

    origin.dependency.exportMappings.push({
      exportedName: candidate.exportedName,
      importedName: origin.importedName,
    });
  }

  return { localExports, dependencies };
}

function parseImports(importClause: ts.ImportClause | undefined): ParsedImports {
  if (importClause === undefined) return { importedNames: null, bindings: [] };

  const bindings: ImportedBinding[] = [];
  if (importClause.name !== undefined) {
    bindings.push({ localName: importClause.name.text, importedName: "default" });
  }

  const namedBindings = importClause.namedBindings;
  if (namedBindings === undefined) {
    return {
      importedNames: [...new Set(bindings.map((binding) => binding.importedName))],
      bindings,
    };
  }
  if (ts.isNamespaceImport(namedBindings)) {
    return { importedNames: null, bindings };
  }

  for (const element of namedBindings.elements) {
    bindings.push({
      localName: element.name.text,
      importedName: (element.propertyName ?? element.name).text,
    });
  }

  return {
    importedNames: [...new Set(bindings.map((binding) => binding.importedName))],
    bindings,
  };
}

function exportMappings(
  exportClause: ts.NamedExportBindings | undefined,
): readonly ExportMapping[] {
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
  mappings: readonly ExportMapping[],
): readonly string[] | null {
  if (mappings.some((mapping) => mapping.importedName === null)) return null;
  return [...new Set(mappings.flatMap((mapping) => mapping.importedName ?? []))];
}

function collectInitializerCandidates(statement: ts.Statement): readonly InitializerCandidate[] {
  if (
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier === undefined &&
    statement.exportClause !== undefined &&
    ts.isNamedExports(statement.exportClause)
  ) {
    return statement.exportClause.elements.map((element) => ({
      exportedName: element.name.text,
      localName: (element.propertyName ?? element.name).text,
    }));
  }

  if (!ts.isVariableStatement(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    return [];
  }

  const candidates: InitializerCandidate[] = [];
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;

    const localName = importedIdentifierFromInitializer(declaration.initializer);
    if (localName !== undefined) {
      candidates.push({ exportedName: declaration.name.text, localName });
    }
  }
  return candidates;
}

function importedIdentifierFromInitializer(initializer: ts.Expression): string | undefined {
  let expression = unwrapExpression(initializer);

  if (ts.isNewExpression(expression) || ts.isCallExpression(expression)) {
    expression = unwrapExpression(expression.expression);
  }

  return ts.isIdentifier(expression) ? expression.text : undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
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
  compilerOptions: ts.CompilerOptions,
  moduleResolutionCache: ts.ModuleResolutionCache,
): FileNode | ExternalModule {
  const result = ts.resolveModuleName(
    specifier,
    containingFile,
    compilerOptions,
    ts.sys,
    moduleResolutionCache,
  );
  const resolved = result.resolvedModule;

  if (resolved === undefined) {
    if (!isRelativeSpecifier(specifier)) return externalModule(specifier);

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

function loadProjectCompilerOptions(projectRoot: string): ts.CompilerOptions {
  const configPath = path.join(projectRoot, "tsconfig.json");
  if (!ts.sys.fileExists(configPath)) return defaultCompilerOptions;

  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error !== undefined) {
    throw new ArchitectureError(
      `Invalid TypeScript configuration:\n${formatTypeScriptDiagnostics([loaded.error], projectRoot)}`,
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );

  if (parsed.errors.length > 0) {
    throw new ArchitectureError(
      `Invalid TypeScript configuration:\n${formatTypeScriptDiagnostics(parsed.errors, projectRoot)}`,
    );
  }

  return parsed.options;
}

function formatTypeScriptDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  projectRoot: string,
): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => projectRoot,
    getNewLine: () => "\n",
  }).trimEnd();
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
