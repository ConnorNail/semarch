# Dependency analysis

Semarch builds a file-level dependency graph from TypeScript syntax. This document describes the exact dependency behavior supported by version 0.1.

## Static imports

Semarch recognizes static imports with:

- default imports
- named and aliased imports
- namespace imports
- side-effect imports
- type-only imports

Type-only imports count as architecture dependencies. Dynamic `import()` expressions are not analyzed.

## Module resolution

Semarch uses the TypeScript module resolver. When a root `tsconfig.json` is present, its compiler options are used, including `baseUrl`, `paths`, and module resolution settings.

External packages, `node_modules`, files outside the project, and non-TypeScript targets are treated as external dependencies and are not architecture-checked.

Semarch reports an error when:

- a relative import cannot be resolved
- an import matching a configured `paths` alias cannot be resolved
- a project-local TypeScript target is omitted by `arch.yaml` include or exclude patterns

These errors prevent an incomplete internal graph from being mistaken for external dependencies.

## Re-exports and barrel files

Semarch follows named, aliased, default, namespace, and wildcard static re-exports.

For a named import, Semarch follows the corresponding exported symbol through the re-export chain. Namespace and side-effect imports conservatively follow every static re-export from the target module.

When a rule is violated through a barrel file, the diagnostic includes the dependency path from the importing file to the classified target.

## Exported initialized values

Semarch can trace a directly exported value to an imported constructor or factory:

```ts
import { PostgresUserRepository } from "./user.repository";

export const userRepository = new PostgresUserRepository();
```

An import of `userRepository` is evaluated against `user.repository.ts`, allowing Semarch to detect repository access through a shared provider module.

Version 0.1 supports direct imported identifiers used as constructors or function calls. It does not trace:

- computed expressions
- property-access constructors or factories
- dependency-injection container lookups
- runtime aliasing

## Inspecting resolution

Use `semarch inspect` to see how a file and its imports were classified and resolved:

```sh
semarch inspect src/users/services/create-user.service.ts
```

Inspection shows imported symbols, internal and external resolution, dependency paths, and matching deny rules. The command exits with code `0` even when it displays architecture violations; configuration and analysis errors still exit with code `2`.
