# Semantic Architecture Checker

An experimental CLI that checks dependency rules against the static import graph of a TypeScript project. It is deliberately small: filesystem classification, TypeScript syntax parsing, dependency resolution, rule matching, and readable diagnostics are kept visible in the code.

## Requirements

- Node.js 22 or newer
- pnpm 10

## Install and run

```sh
pnpm install
pnpm build
node dist/index.js check path/to/project
```

When installed as a package, the binary is named `arch`:

```sh
arch check
arch check ./some-project
arch check ./some-project --config config/architecture.yaml
arch inspect src/users/services/create-user.service.ts
```

The project root defaults to the current directory. The configuration defaults to `arch.yaml` at that root; an explicit `--config` path is resolved relative to the project root.

## Configuration

```yaml
version: 1

include:
  - "src/**/*.{ts,tsx}"

exclude:
  - "**/*.test.ts"
  - "**/*.spec.ts"

domains:
  users:
    root: src/users
  billing:
    root: src/billing

components:
  service:
    match:
      - "**/services/**/*.ts"
  repository:
    match:
      - "**/repositories/**/*.ts"
  transport:
    match:
      - "src/transport/**/*.ts"

rules:
  - deny: service -> transport
  - deny: service -> foreign.repository
```

Domain roots and globs are relative to the project root. Domain roots may not overlap. A discovered file may have no domain or component, but matching more than one component is an error.

`root` is always a literal directory. For domains whose files are spread across several directories, use `match` instead:

```yaml
domains:
  assignment:
    match:
      - "src/**/assignment.*.ts"
```

Each domain must define exactly one of `root` or `match`. A file matching more than one domain is an error.

The rule language supports:

```text
source-component -> target-component
source-component -> local.target-component
source-component -> foreign.target-component
```

`local` and `foreign` match only when both files belong to configured domains. Component names are configuration-defined; `service`, `repository`, and `transport` are conventions rather than hard-coded keywords.

## Behavior

The checker recognizes default, named, namespace, side-effect, and type-only static imports. It also follows named, aliased, default, namespace, and wildcard static re-export chains. Named imports follow only the corresponding exported symbol; namespace and side-effect imports conservatively follow every static re-export.

When a project has a `tsconfig.json`, its compiler options are used for module resolution, including `baseUrl` and `paths`. The checker also traces direct exported initializers back to imported identifiers, including `export const repository = new ImportedRepository()` and direct imported factory calls.

All static dependencies, including type-only imports, are architecture dependencies. External packages, `node_modules`, and paths outside the project are not classified or checked. If an analyzed file imports a project-local TypeScript file omitted by `include` or `exclude`, the checker reports a configuration error rather than silently treating it as external. Imports matching a configured `tsconfig.json` path alias also produce a tool error when they cannot be resolved.

Every check ends with classification counts for files without a domain or component. These counts are informational; unclassified files remain valid unless a rule requires their classification.

## Inspecting the graph

Use `inspect` when a dependency is unexpectedly allowed or rejected:

```sh
arch inspect src/services/courseWork/assignment.service.ts
arch inspect src/services/courseWork/assignment.service.ts --root ./some-project
```

The command reports the file classification, each import's internal or external resolution, imported symbols, static re-export or initializer provenance paths, and any matching deny rules. Inspection succeeds with exit code `0` even when the selected file has architecture violations; configuration and analysis failures still exit with code `2`.

Exit codes are stable:

- `0`: no violations
- `1`: one or more architecture violations
- `2`: invalid configuration or a tool error, including ambiguous classification, TypeScript syntax errors, unresolved relative imports or configured aliases, and excluded internal TypeScript dependencies

Diagnostics are plain text and deterministic. They include the import location and specifier, source and target classifications, violated rule, and the dependency path for a barrel traversal.

## Development

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm benchmark
```

Tests combine focused unit cases with complete fixture projects. The benchmark generates 1,000 temporary source files and reports elapsed time; the prototype target is under two seconds on a development laptop, but timing is not a CI gate.

## Demo project

A deliberately broken example is available in [`examples/demo-project`](examples/demo-project). It includes valid local-repository and cross-domain-service dependencies, plus transport and barrel-mediated foreign-repository violations.

```sh
pnpm build
node dist/index.js check examples/demo-project
```

See the [demo instructions](examples/demo-project/README.md) for the expected results and how to make the project pass.

## v0.1 boundaries

This release does not use a TypeScript `Program` or perform semantic type checking. It does not support dynamic imports, JavaScript files, computed or property-access initializer provenance, dependency-injection container lookups, JSON output, watch mode, caching, plugins, or IDE integration. Only `arch.yaml` and a root `tsconfig.json` are discovered automatically.

The next analysis layer should be symbol and type information, but only after this import-graph prototype proves useful on real projects.
