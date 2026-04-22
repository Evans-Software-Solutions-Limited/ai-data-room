# microservices/core/src

Layered architecture. One directory per layer, one sub-directory per feature slice inside each layer. Pattern copied from `funds-distribution-platform`.

```
src/
  api.ts                           # Elysia app — mounts handlers
  index.ts                         # exports CoreApi type for Eden treaty
  domain/<slice>/*.ts              # types, enums, invariants, zod schemas
  application/<slice>/*.ts         # use cases, pure functions, orchestration
  handlers/<slice>/*.ts            # HTTP routes — mount in api.ts
  infrastructure/
    db/<slice>/*.ts                # typed repos calling @ai-data-room/db
    workos/*.ts                    # WorkOS SDK wrapper (slice 1)
    stripe/*.ts                    # Stripe SDK wrapper (slice 8)
    anthropic/*.ts                 # Anthropic SDK wrapper (slices 5 + 6)
    s3/*.ts                        # document storage adapter (slice 2)
    sqs/*.ts                       # async message bus adapter (slice 5)
  middleware/                      # requires(), requireWritesEnabled, etc.
```

## Conventions

- **Nothing crosses a layer boundary except DTOs.** Handlers never import Drizzle types. Infrastructure never imports handler types.
- **Zod schemas live in `domain/<slice>` when they describe domain shapes**, or in `@ai-data-room/api-utils/schemas/<slice>` when they describe wire-format. Wire-format schemas MUST be importable by the web package.
- **Every handler file mounts exactly one Elysia sub-app** and exports it as the default export, then `api.ts` wires it.
- **No raw SQL in handlers or application.** Reach for `infrastructure/db/<slice>/*Repo.ts` — if it doesn't exist, make it.
- **Auth:** every authenticated route must run `requires(roles[], opts?)` from `middleware/requires.ts`. Writes must additionally pass `requireWritesEnabled` once slice 8 lands.

## Why the hello-world module is still here

Smoke-test route so `sst dev` proves end-to-end wiring before slice 1 auth routes are written. Remove it during slice 1 T-007 when real `/me` etc. replace it.
