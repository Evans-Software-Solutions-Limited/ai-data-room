// Module-scope WorkOS client for the auth surface.
//
// Slice 1 / T-015 + T-014b. The same instance is reused by
// `requireAuth` (sealed-session validation) and by every protected
// handler that touches WorkOS (via `protectedDeps.workos`). SST
// surfaces `Resource.*` before Lambda init, so the construction
// happens once at cold start; warm requests reuse the closed-over
// SDK instance without re-allocating.
//
// Lives in its own module (rather than only inside `_shared/deps.ts`)
// so that `requireAuth` can import the WorkOS client without dragging
// in the database client or any of the repos — which it doesn't need
// and shouldn't be coupled to. Keeps the requireAuth test surface
// narrow: it mocks `sst` + `@workos-inc/node` only.
//
// If `Resource.WORKOS_API_KEY.value` or `Resource.WORKOS_CLIENT_ID.value`
// are malformed, the SDK constructor throws here at module load and
// the Lambda fails to boot — surfacing as a deploy-time issue rather
// than as a per-request 500. That's the right shape: bad WorkOS
// config is a misconfigured stack, not a user-recoverable condition.

import { Resource } from "sst";

import { createWorkOSClient } from "../../../infrastructure/workos/client";

export const workos = createWorkOSClient({
  apiKey: Resource.WORKOS_API_KEY.value,
  clientId: Resource.WORKOS_CLIENT_ID.value,
});
