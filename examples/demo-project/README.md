# Demo project

This small TypeScript project demonstrates the architecture checker with both allowed and forbidden dependencies.

From the repository root, build and run the checker:

```sh
pnpm build
node dist/index.js check examples/demo-project
```

The sample itself can also be type-checked from the repository root:

```sh
pnpm exec tsc --project examples/demo-project/tsconfig.json
```

The command should report two violations and exit with code `1`:

1. `CreateUserService` imports a transport-layer request type.
2. `CreateUserService` reaches `BillingRepository` through the billing barrel file.

The following dependencies are allowed and should not be reported:

- `CreateUserService` → `UserRepository` because the repository is local to the `users` domain.
- `CreateUserService` → `BillingService` because cross-domain service dependencies are allowed.
- `BillingService` → `BillingRepository` because the repository is local to the `billing` domain.

To make the demo pass, remove the `CreateUserRequest` and `BillingRepository` imports and their constructor parameters from `src/users/services/create-user.service.ts`. Running the checker again should exit with code `0`.
