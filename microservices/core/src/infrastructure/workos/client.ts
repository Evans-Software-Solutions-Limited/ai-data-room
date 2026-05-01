// Thin wrapper over `@workos-inc/node`'s `UserManagement` surface.
//
// Slice 1 / T-006. Exposes only the 8 operations the auth-and-orgs
// design.md actually consumes — anything else stays out of the wrapper
// so we don't accidentally couple the application layer to SDK
// surface area we don't need.
//
// Architecture:
//   - **Factory function**, not a class. Module load is side-effect
//     free (T-006 DoD); the SDK is constructed only when `createWorkOSClient`
//     is invoked at handler entry. Tests can `vi.doMock(\"@workos-inc/node\", ...)`
//     then re-import without worrying about a stale singleton.
//   - **Pure infrastructure** — secrets are passed in by the caller;
//     this file does NOT import `Resource` from `sst`. Handlers read
//     `Resource.WORKOS_API_KEY.value` themselves and pass it down.
//     Keeps the wrapper unit-testable without an SST shim.
//   - **Re-exports SDK types** (`User`, `Invitation`,
//     `AuthenticationResponse`) so the application layer never has to
//     `import { ... } from \"@workos-inc/node\"`. Crossing that boundary
//     would defeat the layered-architecture rule in CLAUDE.md.
//
// One subtlety: the WorkOS SDK has no `sendPasswordResetEmail` method
// at v8 — the equivalent is `userManagement.createPasswordReset({ email })`,
// which mints a token and (when AuthKit hosted UI is in play) WorkOS
// delivers the email. We keep the spec-driven name `sendPasswordResetEmail`
// at the wrapper boundary and call through to `createPasswordReset`
// internally. T-011 (the application layer) sees only the wrapper name.

import { WorkOS } from "@workos-inc/node";
import type {
  AuthenticateWithCodeOptions,
  AuthenticationResponse,
  CreatePasswordResetOptions,
  Invitation,
  PasswordReset,
  RevokeSessionOptions,
  SendInvitationOptions,
  Session,
  User,
  UserManagementAuthorizationURLOptions,
} from "@workos-inc/node";

// Re-export the SDK shapes the application layer needs. Keeps
// `application/*.ts` from ever having to `import "@workos-inc/node"`
// directly — handlers only see this module.
export type {
  AuthenticateWithCodeOptions,
  AuthenticationResponse,
  CreatePasswordResetOptions,
  Invitation,
  PasswordReset,
  RevokeSessionOptions,
  SendInvitationOptions,
  Session,
  User,
  UserManagementAuthorizationURLOptions,
};

/**
 * Wrapper config. Both fields are required: the SDK accepts
 * `apiKey`-only or `clientId`-only, but every flow this slice uses
 * (authorization URL, code exchange, invitations, sessions) needs
 * both.
 */
export interface WorkOSClientConfig {
  apiKey: string;
  clientId: string;
}

/**
 * Public surface of the wrapper. Mirrors the 8 operations from
 * §Interfaces in design.md plus the password-reset rename noted in
 * the file header. Handlers depend on this interface, never on the
 * concrete return of `createWorkOSClient`, so we can swap to a
 * different identity provider in a future ADR without touching them.
 */
export interface WorkOSClient {
  getAuthorizationUrl(options: UserManagementAuthorizationURLOptions): string;
  authenticateWithCode(
    payload: AuthenticateWithCodeOptions,
  ): Promise<AuthenticationResponse>;
  getUser(userId: string): Promise<User>;
  deleteUser(userId: string): Promise<void>;
  createInvitation(payload: SendInvitationOptions): Promise<Invitation>;
  revokeInvitation(invitationId: string): Promise<Invitation>;
  sendPasswordResetEmail(
    options: CreatePasswordResetOptions,
  ): Promise<PasswordReset>;
  revokeSession(payload: RevokeSessionOptions): Promise<void>;
  /**
   * List every session WorkOS has on file for a user, walking the
   * SDK's `AutoPaginatable` so the caller gets a flat array rather
   * than a paginator handle. Added in T-012 because the suspension
   * flow needs to revoke every active session before flipping our
   * local `lifecycle_state` (FR21(b)). T-011 (password reset on
   * `password_reset_completed`) reuses the same shape.
   */
  listSessions(userId: string): Promise<Session[]>;
}

/**
 * Construct a WorkOS client wrapper.
 *
 * Pattern usage at handler scope (warm-Lambda safe):
 *
 *   const workos = createWorkOSClient({
 *     apiKey: Resource.WORKOS_API_KEY.value,
 *     clientId: Resource.WORKOS_CLIENT_ID.value,
 *   });
 *   await workos.authenticateWithCode({ ... });
 *
 * Don't lift the call to module top-level — `Resource` is not
 * available before the Lambda's module-init phase has the SST runtime
 * attached, and tests can't `vi.doMock` the SDK without first
 * resetting the module.
 */
export function createWorkOSClient(config: WorkOSClientConfig): WorkOSClient {
  const sdk = new WorkOS(config.apiKey, { clientId: config.clientId });
  const um = sdk.userManagement;

  return {
    getAuthorizationUrl: (options) => um.getAuthorizationUrl(options),
    authenticateWithCode: (payload) => um.authenticateWithCode(payload),
    getUser: (userId) => um.getUser(userId),
    deleteUser: (userId) => um.deleteUser(userId),
    createInvitation: (payload) => um.sendInvitation(payload),
    revokeInvitation: (invitationId) => um.revokeInvitation(invitationId),
    // See file header for the createPasswordReset → sendPasswordResetEmail
    // rename rationale.
    sendPasswordResetEmail: (options) => um.createPasswordReset(options),
    revokeSession: (payload) => um.revokeSession(payload),
    listSessions: async (userId) => {
      const result = await um.listSessions(userId);
      return result.autoPagination();
    },
  };
}
