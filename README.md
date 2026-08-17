# Semarch

**Enforce architectural boundaries in TypeScript.**

Semarch is an experimental architecture checker for TypeScript projects. It lets you classify files into domains and components, then define which dependencies between them are forbidden.

Instead of relying only on documentation and code review to remember rules such as:

- services should not depend on transport-layer code
- services should not directly access repositories owned by another domain
- specific component types should not depend on one another

you can make those boundaries executable:

```yaml
rules:
  - deny: service -> transport
  - deny: service -> foreign.repository
```

Then run:

```sh
npx semarch check
```

Semarch reports the source, target, violated rule, and import location for each violation. It also reports dependency paths when an import reaches a violation through a re-export or exported initializer. A foreign repository rule prevents direct repository access; teams can route that interaction through the other domain's service or public API.

> Semarch is currently experimental. Version 0.1 focuses deliberately on static, file-level architecture before adding deeper symbol- and type-aware analysis.

## Quick start

### Requirements

- Node.js 22 or newer

### Install

Install Semarch as a development dependency:

```sh
npm install --save-dev semarch
```

Create `arch.yaml` in your project root:

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

Run the check:

```sh
npx semarch check
```

This dependency is allowed because the repository is local to the `users` domain:

```text
users.service -> users.repository
```

This dependency is denied because the service accesses a repository owned by `billing`:

```text
users.service -> billing.repository
```

Violations produce exit code `1`, making the same command suitable for local development and CI.

## How configuration works

Semarch describes file-level architecture using domains, components, and dependency rules. All paths and glob patterns are relative to the project root.

### Domains

Domains represent logical areas of an application:

```yaml
domains:
  users:
    root: src/users

  billing:
    root: src/billing
```

A file beneath `src/users` belongs to the `users` domain. Literal domain roots may not overlap.

If a domain is spread across multiple locations, use `match` instead:

```yaml
domains:
  assignment:
    match:
      - "src/**/assignment.*.ts"
```

Each domain must define exactly one of `root` or `match`. A file may have no domain, but matching more than one domain is a configuration error.

### Components

Components represent architectural roles:

```yaml
components:
  service:
    match:
      - "**/services/**/*.ts"

  repository:
    match:
      - "**/repositories/**/*.ts"
```

Component names are configurable. Names such as `service`, `repository`, and `transport` are conventions, not built-in concepts. A file may have no component, but matching more than one component is a configuration error.

### Rules

Version 0.1 supports deny rules between component types:

```text
source-component -> target-component
source-component -> local.target-component
source-component -> foreign.target-component
```

For example:

```yaml
rules:
  - deny: service -> transport
  - deny: service -> foreign.repository
```

`local` means the source and target belong to the same configured domain. `foreign` means they belong to different configured domains. Relational rules match only when both files have a domain.

With the configuration above:

```text
users.service -> users.repository       allowed
users.service -> billing.service        allowed
users.service -> billing.repository     denied
```

## Commands

Check the current project:

```sh
semarch check
```

Check another project:

```sh
semarch check ./some-project
```

Use a different configuration file:

```sh
semarch check ./some-project --config config/architecture.yaml
```

The project root defaults to the current directory. Semarch requires `arch.yaml` at that root unless `--config` is provided.

### Inspect a file

If a dependency is unexpectedly allowed or rejected, inspect the file to see how Semarch resolved it:

```sh
semarch inspect src/users/services/create-user.service.ts
semarch inspect src/users/services/create-user.service.ts --root ./some-project
```

`inspect` reports:

- domain and component classification
- resolved imports
- internal and external dependencies
- imported symbols
- dependency paths through barrel files and repository providers
- matching deny rules

Inspection exits with code `0` even when it displays architecture violations. Configuration and analysis errors still exit with code `2`.

## TypeScript dependency support

Semarch follows static TypeScript imports and re-exports, including barrel files. When a root `tsconfig.json` is present, Semarch uses it for module resolution, including `baseUrl` and `paths`. Type-only imports count as architecture dependencies.

External packages, `node_modules`, and paths outside the project are ignored. Excluded project-local files, unresolved relative imports, and unresolved configured path aliases are reported as errors rather than silently treated as external.

See [dependency analysis](https://github.com/ConnorNail/semarch/blob/main/docs/dependency-analysis.md) for exact traversal behavior and limitations.

## Diagnostics and exit codes

Diagnostics identify the import location, source and target classifications, violated rule, and dependency path when relevant. Every check also reports informational counts for files without a domain or component.

| Code | Meaning |
| --- | --- |
| `0` | No architecture violations |
| `1` | Architecture violations found |
| `2` | Invalid configuration or analysis error |

## Current scope

Version 0.1 deliberately focuses on the static TypeScript file dependency graph. It does not use a TypeScript `Program` or perform semantic type checking.

Semarch does not currently support:

- dynamic imports
- JavaScript files
- dependency-injection container lookups
- JSON output
- watch mode
- caching
- plugins
- IDE integration

Only a root `arch.yaml` and root `tsconfig.json` are discovered automatically. The longer-term direction may include symbol- and type-aware rules, but only after the current architecture model has been tested against real projects.

## Demo

A deliberately broken example project is available in [`examples/demo-project`](examples/demo-project). It contains allowed dependencies and intentional transport and cross-domain repository violations.

From a source checkout, run:

```sh
pnpm build
node dist/index.js check examples/demo-project
```

See the [demo instructions](examples/demo-project/README.md) for the expected result and how to make the project pass.

## Feedback

Semarch is early, and feedback from real TypeScript projects is especially useful. Please open an issue for:

- architecture rules that are difficult to express
- project structures Semarch handles incorrectly
- confusing configuration or diagnostics
- incorrect module or dependency resolution
- false positives or missed dependencies

Bug fixes, tests, and documentation improvements are also welcome. For larger features or changes to the configuration model, please open an issue first.

## License

[MIT](LICENSE.md)
