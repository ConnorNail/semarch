export type DomainRelation = "local" | "foreign";

export interface DomainDefinition {
  name: string;
  root: string | undefined;
  match: readonly string[];
}

export interface ComponentDefinition {
  name: string;
  match: readonly string[];
}

export interface Rule {
  sourceComponent: string;
  targetComponent: string;
  domainRelation: DomainRelation | undefined;
  display: string;
}

export interface ArchitectureConfig {
  version: 1;
  include: readonly string[];
  exclude: readonly string[];
  domains: readonly DomainDefinition[];
  components: readonly ComponentDefinition[];
  rules: readonly Rule[];
}

export interface ExternalModule {
  kind: "external";
  specifier: string;
}

export interface ExportMapping {
  exportedName: string | null;
  importedName: string | null;
}

export interface DependencyEdge {
  kind: "import" | "reexport";
  source: FileNode;
  target: FileNode | ExternalModule;
  specifier: string;
  line: number;
  column: number;
  importedNames: readonly string[] | null;
  exportMappings: readonly ExportMapping[];
}

export interface FileNode {
  path: string;
  absolutePath: string;
  domain: string | undefined;
  component: string | undefined;
  localExports: ReadonlySet<string>;
  dependencies: DependencyEdge[];
}

export interface ProjectGraph {
  root: string;
  files: ReadonlyMap<string, FileNode>;
}

export interface Violation {
  source: FileNode;
  target: FileNode;
  edge: DependencyEdge;
  rule: Rule;
  dependencyPath: readonly FileNode[];
}

export interface CheckResult {
  graph: ProjectGraph;
  violations: readonly Violation[];
}
