// Integration tests for the protected route bundle (Slice 1 / T-015
// + T-014b).
//
// Same `vi.doMock(...) + vi.resetModules() + dynamic import` shape
// as `publicRoutes.test.ts`, extended to mock the database and the
// six repo modules so the bundle's lazy module-scope construction
// of `userRepo` / `orgRepo` (and the per-handler repo construction
// inside each route body) all resolve to the test doubles.
//
// The unit-tested concerns (`requireAuth` branches, `resolveActor`'s
// lazy-mirror, `requireOrg`'s 403, `authorizeOrgAccess`'s three
// failure modes, every audit-context header parse) live in the
// guard / helper test files. This file only proves the bundle wires
// them together correctly: routes mount at expected paths, guards
// run in order, and each handler's error→status mapping fires.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Elysia from "elysia";

const ALL_SECRETS = {
  WORKOS_CLIENT_ID: { value: "client_test_123" },
  WORKOS_API_KEY: { value: "sk_test_abc" },
  WORKOS_COOKIE_PASSWORD: { value: "x".repeat(32) },
  WORKOS_WEBHOOK_SECRET: { value: "whsec_test" },
  PLANETSCALE_DATABASE_URL: { value: "postgres://stub" },
  // org-provisioning T-005: `deps.ts` reads `Resource.CoreEventBus.name`
  // to construct the EventBridge `org.created` publisher.
  CoreEventBus: {
    name: "core-bus-test",
    arn: "arn:aws:events:eu-west-2:000000000000:event-bus/core-bus-test",
  },
};

const LOCAL_USER_ID = "11111111-1111-4111-8111-111111111111";
const LOCAL_ORG_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_USER_ID = "33333333-3333-4333-8333-333333333333";
const INVITATION_ID = "44444444-4444-4444-8444-444444444444";

// room-and-folders (slice 2) / T-011
const OPPORTUNITY_ID = "a1111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "a2222222-2222-4222-8222-222222222222";
const VERSION_ID = "a3333333-3333-4333-8333-333333333333";

const SESSION_USER = {
  object: "user" as const,
  id: "user_workos_xyz",
  email: "alice@example.com",
  firstName: "Alice",
  lastName: "Example",
  emailVerified: true,
  profilePictureUrl: null,
  lastSignInAt: null,
  locale: null,
  externalId: null,
  metadata: {},
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const LOCAL_USER = {
  id: LOCAL_USER_ID,
  workosUserId: SESSION_USER.id,
  email: SESSION_USER.email,
  fullName: "Alice Example",
  lifecycleState: "active" as const,
  emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  mfaEnrolledAt: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const LOCAL_ORG = {
  id: LOCAL_ORG_ID,
  workosOrgId: "org_workos_abc",
  name: "ACME Corp",
  slug: "acme-corp",
  status: "active" as const,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const OWNER_MEMBERSHIP = {
  id: "55555555-5555-5555-8555-555555555555",
  orgId: LOCAL_ORG_ID,
  userId: LOCAL_USER_ID,
  role: "owner" as const,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

// room-and-folders (slice 2) / T-011 fixtures
const OPPORTUNITY = {
  id: OPPORTUNITY_ID,
  orgId: LOCAL_ORG_ID,
  slug: "vendor-a",
  name: "Vendor A",
  status: "active" as const,
  archivedAt: null,
  createdBy: LOCAL_USER_ID,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const DOCUMENT_VERSION = {
  id: VERSION_ID,
  documentId: DOCUMENT_ID,
  orgId: LOCAL_ORG_ID,
  versionNumber: 1,
  originalFilename: "contract.pdf",
  mimeType: "application/pdf" as const,
  sizeBytes: 1024,
  sha256: "a".repeat(64),
  s3Key: `orgs/${LOCAL_ORG_ID}/documents/${DOCUMENT_ID}/${VERSION_ID}`,
  s3VersionId: null,
  uploadedBy: LOCAL_USER_ID,
  uploadedAt: new Date("2026-01-01T00:00:00Z"),
};

const DOCUMENT = {
  id: DOCUMENT_ID,
  orgId: LOCAL_ORG_ID,
  folderKind: "canonical" as const,
  canonicalFolder: "02_Financials" as const,
  opportunityId: null,
  displayName: "contract.pdf",
  currentVersionId: VERSION_ID,
  state: "active" as const,
  softDeletedAt: null,
  createdBy: LOCAL_USER_ID,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

interface MockSetup {
  authenticate: ReturnType<typeof vi.fn>;
  // userRepo
  userFindById: ReturnType<typeof vi.fn>;
  userFindByWorkosUserId: ReturnType<typeof vi.fn>;
  userCreate: ReturnType<typeof vi.fn>;
  // orgRepo
  orgFindById: ReturnType<typeof vi.fn>;
  orgFindByWorkosOrgId: ReturnType<typeof vi.fn>;
  orgFindBySlug: ReturnType<typeof vi.fn>;
  orgCreate: ReturnType<typeof vi.fn>;
  // membershipRepo
  membershipFindByOrgUser: ReturnType<typeof vi.fn>;
  membershipFindByUser: ReturnType<typeof vi.fn>;
  membershipCreate: ReturnType<typeof vi.fn>;
  // externalGrantRepo
  grantListByUser: ReturnType<typeof vi.fn>;
  // invitationRepo
  invitationCreate: ReturnType<typeof vi.fn>;
  invitationFindById: ReturnType<typeof vi.fn>;
  invitationListByOrgAndState: ReturnType<typeof vi.fn>;
  invitationTransitionState: ReturnType<typeof vi.fn>;
  // auditRepo
  auditWrite: ReturnType<typeof vi.fn>;
  auditListByOrg: ReturnType<typeof vi.fn>;
  // workos
  workosCreateInvitation: ReturnType<typeof vi.fn>;
  workosRevokeInvitation: ReturnType<typeof vi.fn>;
  workosListSessions: ReturnType<typeof vi.fn>;
  workosRevokeSession: ReturnType<typeof vi.fn>;
  workosCreateOrganization: ReturnType<typeof vi.fn>;
  workosDeleteOrganization: ReturnType<typeof vi.fn>;
  // room-and-folders (slice 2) / T-011 — opportunityRepo
  opportunityCreate: ReturnType<typeof vi.fn>;
  opportunityFindById: ReturnType<typeof vi.fn>;
  opportunityFindBySlug: ReturnType<typeof vi.fn>;
  opportunityListActive: ReturnType<typeof vi.fn>;
  opportunityRename: ReturnType<typeof vi.fn>;
  opportunityArchive: ReturnType<typeof vi.fn>;
  // documentRepo
  documentCreate: ReturnType<typeof vi.fn>;
  documentFindById: ReturnType<typeof vi.fn>;
  documentFindActiveByName: ReturnType<typeof vi.fn>;
  documentGetWithCurrentVersion: ReturnType<typeof vi.fn>;
  documentListByCanonicalFolderWithVersion: ReturnType<typeof vi.fn>;
  documentListByOpportunityWithVersion: ReturnType<typeof vi.fn>;
  documentMarkActive: ReturnType<typeof vi.fn>;
  documentSetCurrentVersion: ReturnType<typeof vi.fn>;
  documentSoftDelete: ReturnType<typeof vi.fn>;
  documentRestore: ReturnType<typeof vi.fn>;
  documentPurgeDraft: ReturnType<typeof vi.fn>;
  // documentVersionRepo
  versionCreate: ReturnType<typeof vi.fn>;
  versionFindById: ReturnType<typeof vi.fn>;
  versionListByDocument: ReturnType<typeof vi.fn>;
  versionLatestVersionNumber: ReturnType<typeof vi.fn>;
  // externalGrantRepo (room extensions)
  grantRetargetOpportunitySlug: ReturnType<typeof vi.fn>;
  grantRevokeActiveForOpportunity: ReturnType<typeof vi.fn>;
  // S3 document store (mocked at the `createS3DocumentStore` factory)
  storeCreateMultipartUpload: ReturnType<typeof vi.fn>;
  storePresignPartUrls: ReturnType<typeof vi.fn>;
  storeCompleteMultipartUpload: ReturnType<typeof vi.fn>;
  storeAbortMultipartUpload: ReturnType<typeof vi.fn>;
  storePresignDownloadUrl: ReturnType<typeof vi.fn>;
  storeHeadObject: ReturnType<typeof vi.fn>;
  storeDeleteObject: ReturnType<typeof vi.fn>;
  storeTagObject: ReturnType<typeof vi.fn>;
  storeComputeSha256: ReturnType<typeof vi.fn>;
}

function setupMocks(): MockSetup {
  vi.doMock("sst", () => ({ Resource: ALL_SECRETS }));

  const authenticate = vi.fn().mockResolvedValue({
    authenticated: true,
    user: SESSION_USER,
    organizationId: LOCAL_ORG.workosOrgId,
  });
  const session = {
    authenticate,
    refresh: vi.fn(),
    getLogoutUrl: vi.fn(),
  };
  const loadSealedSession = vi.fn().mockReturnValue(session);
  const workosCreateInvitation = vi.fn();
  const workosRevokeInvitation = vi.fn();
  const workosListSessions = vi.fn().mockResolvedValue([]);
  const workosRevokeSession = vi.fn();
  const workosCreateOrganization = vi
    .fn()
    .mockResolvedValue({ id: "org_workos_new" });
  const workosDeleteOrganization = vi.fn().mockResolvedValue(undefined);
  vi.doMock("@workos-inc/node", () => ({
    WorkOS: class {
      userManagement = {
        loadSealedSession,
        getAuthorizationUrl: vi.fn(),
        authenticateWithCode: vi.fn(),
        listSessions: { autoPagination: workosListSessions },
        revokeSession: workosRevokeSession,
        sendInvitation: workosCreateInvitation,
        revokeInvitation: workosRevokeInvitation,
        createPasswordReset: vi.fn(),
        getUser: vi.fn(),
        deleteUser: vi.fn(),
      };
      organizations = {
        createOrganization: workosCreateOrganization,
        deleteOrganization: workosDeleteOrganization,
      };
    },
  }));

  vi.doMock("@ai-data-room/db", () => ({
    getDb: vi.fn().mockReturnValue({
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({}),
      ),
    }),
  }));

  // org-provisioning T-005: stub the EventBridge SDK so the wired
  // `org.created` publisher (in `deps.ts`) never reaches the network on
  // the POST /orgs path. `PutEvents` resolves with no failed entries.
  vi.doMock("@aws-sdk/client-eventbridge", () => ({
    EventBridgeClient: class {
      send = vi.fn().mockResolvedValue({ FailedEntryCount: 0 });
    },
    PutEventsCommand: class {
      constructor(public input: unknown) {}
    },
  }));

  // Repo classes — mocked to instances whose methods are vi.fn()s
  // we can configure per-test.
  const userFindById = vi.fn();
  const userFindByWorkosUserId = vi.fn();
  const userCreate = vi.fn();
  vi.doMock("../../../infrastructure/db/userRepo", () => ({
    UserRepo: class {
      findById = userFindById;
      findByWorkosUserId = userFindByWorkosUserId;
      create = userCreate;
      withTx = () => this;
    },
  }));

  const orgFindById = vi.fn();
  const orgFindByWorkosOrgId = vi.fn();
  const orgFindBySlug = vi.fn().mockResolvedValue(null);
  const orgCreate = vi.fn().mockResolvedValue(LOCAL_ORG);
  vi.doMock("../../../infrastructure/db/orgRepo", () => ({
    OrgRepo: class {
      findById = orgFindById;
      findByWorkosOrgId = orgFindByWorkosOrgId;
      findBySlug = orgFindBySlug;
      create = orgCreate;
      withTx = () => this;
    },
  }));

  // T-004: `MembershipRepo` is now a `ScopedRepo` subclass — the org
  // predicate is bound at construction (`scopedRepo(orgId, db)`), so
  // the mock's methods take one fewer argument than pre-T-004
  // (`findByOrgUser(orgId, userId)` → `findMember(userId)`,
  // `findOwnerForOrg(orgId)` → `findOwner()`). `findByUser` /
  // `lockForUserCreate` moved to the `TenantBootstrapRepo` mock below
  // — they run before a tenant context (and hence a bound org) exists.
  const membershipFindByOrgUser = vi.fn();
  const membershipCreate = vi.fn().mockResolvedValue(OWNER_MEMBERSHIP);
  vi.doMock("../../../infrastructure/db/membershipRepo", () => ({
    MembershipRepo: class {
      findMember = membershipFindByOrgUser;
      findOwner = vi.fn().mockResolvedValue(null);
      list = vi.fn().mockResolvedValue([]);
      create = membershipCreate;
      withTx = () => this;
    },
  }));

  // T-004: the org-side roster read is `list()` (no explicit orgId);
  // the self-read of a user's own grants moved to
  // `TenantBootstrapRepo.listGrantsForUser` (below) since it must work
  // for external users, who have no `localOrgId` / scoped handle.
  //
  // room-and-folders (slice 2) / T-011: `retargetOpportunitySlug` /
  // `revokeActiveForOpportunity` back `renameOpportunity` /
  // `archiveOpportunity` (ADR-014).
  const grantRetargetOpportunitySlug = vi.fn().mockResolvedValue(undefined);
  const grantRevokeActiveForOpportunity = vi.fn().mockResolvedValue(0);
  vi.doMock("../../../infrastructure/db/externalGrantRepo", () => ({
    ExternalGrantRepo: class {
      create = vi.fn();
      list = vi.fn().mockResolvedValue([]);
      retargetOpportunitySlug = grantRetargetOpportunitySlug;
      revokeActiveForOpportunity = grantRevokeActiveForOpportunity;
      withTx = () => this;
    },
  }));

  const invitationCreate = vi.fn();
  const invitationFindById = vi.fn();
  const invitationListByOrgAndState = vi.fn();
  const invitationTransitionState = vi.fn();
  vi.doMock("../../../infrastructure/db/invitationRepo", () => ({
    InvitationRepo: class {
      create = invitationCreate;
      findById = invitationFindById;
      listByState = invitationListByOrgAndState;
      transitionState = invitationTransitionState;
      withTx = () => this;
    },
  }));

  const auditWrite = vi.fn().mockResolvedValue({
    id: "audit_id",
    occurredAt: new Date(),
  });
  // T-004: the org-scoped audit READ moved off `AuditRepo.listByOrg`
  // (removed — the writer stays unscoped, see `auditRepo.ts`) onto
  // `ScopedAuditReadRepo.list()`, the class `scopedRepo()` exports as
  // `auditReads`.
  const auditListByOrg = vi.fn().mockResolvedValue([]);
  vi.doMock("../../../infrastructure/db/auditRepo", () => ({
    AuditRepo: class {
      write = auditWrite;
      withTx = () => this;
    },
    ScopedAuditReadRepo: class {
      list = auditListByOrg;
      withTx = () => this;
    },
  }));

  // room-and-folders (slice 2) / T-004 scoped repos. Imported by the
  // real `scoped.ts` factory (which this suite exercises via
  // `resolveScopedRepos`); mocked so their real modules' top-level
  // `const { table } = schema` never runs against this file's
  // schema-less `@ai-data-room/db` mock. T-011 extends these from
  // empty classes to cover every method the room handlers' app
  // functions call. `scopeOrgId` mirrors the real `ScopedRepo` base's
  // getter — fixed to `LOCAL_ORG_ID` since every room test runs as
  // that org's actor.
  const opportunityCreate = vi.fn();
  const opportunityFindById = vi.fn();
  const opportunityFindBySlug = vi.fn().mockResolvedValue(null);
  const opportunityListActive = vi.fn().mockResolvedValue([]);
  const opportunityRename = vi.fn();
  const opportunityArchive = vi.fn();
  vi.doMock("../../../infrastructure/db/opportunityRepo", () => ({
    OpportunityRepo: class {
      scopeOrgId = LOCAL_ORG_ID;
      create = opportunityCreate;
      findById = opportunityFindById;
      findBySlug = opportunityFindBySlug;
      listActive = opportunityListActive;
      rename = opportunityRename;
      archive = opportunityArchive;
      withTx = () => this;
    },
  }));

  const documentCreate = vi.fn();
  const documentFindById = vi.fn();
  const documentFindActiveByName = vi.fn().mockResolvedValue(null);
  const documentGetWithCurrentVersion = vi.fn();
  const documentListByCanonicalFolderWithVersion = vi
    .fn()
    .mockResolvedValue([]);
  const documentListByOpportunityWithVersion = vi.fn().mockResolvedValue([]);
  const documentMarkActive = vi.fn();
  const documentSetCurrentVersion = vi.fn();
  const documentSoftDelete = vi.fn();
  const documentRestore = vi.fn();
  const documentPurgeDraft = vi.fn().mockResolvedValue(null);
  vi.doMock("../../../infrastructure/db/documentRepo", () => ({
    DocumentRepo: class {
      scopeOrgId = LOCAL_ORG_ID;
      create = documentCreate;
      findById = documentFindById;
      findActiveByName = documentFindActiveByName;
      getWithCurrentVersion = documentGetWithCurrentVersion;
      listByCanonicalFolderWithVersion =
        documentListByCanonicalFolderWithVersion;
      listByOpportunityWithVersion = documentListByOpportunityWithVersion;
      markActive = documentMarkActive;
      setCurrentVersion = documentSetCurrentVersion;
      softDelete = documentSoftDelete;
      restore = documentRestore;
      purgeDraft = documentPurgeDraft;
      withTx = () => this;
    },
  }));

  const versionCreate = vi.fn();
  const versionFindById = vi.fn();
  const versionListByDocument = vi.fn().mockResolvedValue([]);
  const versionLatestVersionNumber = vi.fn().mockResolvedValue(0);
  vi.doMock("../../../infrastructure/db/documentVersionRepo", () => ({
    DocumentVersionRepo: class {
      scopeOrgId = LOCAL_ORG_ID;
      create = versionCreate;
      findById = versionFindById;
      listByDocument = versionListByDocument;
      latestVersionNumber = versionLatestVersionNumber;
      withTx = () => this;
    },
    rowToVersion: vi.fn(),
  }));
  vi.doMock("../../../infrastructure/db/documentDeletionRepo", () => ({
    DocumentDeletionRepo: class {
      scopeOrgId = LOCAL_ORG_ID;
      withTx = () => this;
    },
  }));

  // The S3 document store — mocked at the `createS3DocumentStore`
  // factory (per the T-011 brief: "less brittle" than mocking the raw
  // `@aws-sdk/client-s3` SDK). `roomDeps.ts` still constructs a real
  // `S3Client`, but nothing in this suite ever calls `.send()` on it —
  // every room handler goes through this stubbed store instead.
  const storeCreateMultipartUpload = vi.fn().mockResolvedValue("s3-upload-id");
  const storePresignPartUrls = vi
    .fn()
    .mockResolvedValue([{ partNumber: 1, url: "https://s3.example/part1" }]);
  const storeCompleteMultipartUpload = vi
    .fn()
    .mockResolvedValue({ versionId: "s3-version-1" });
  const storeAbortMultipartUpload = vi.fn().mockResolvedValue(undefined);
  const storePresignDownloadUrl = vi
    .fn()
    .mockResolvedValue("https://s3.example/download");
  const storeHeadObject = vi
    .fn()
    .mockResolvedValue({ sizeBytes: 1024, contentType: "application/pdf" });
  const storeDeleteObject = vi.fn().mockResolvedValue(undefined);
  const storeTagObject = vi.fn().mockResolvedValue(undefined);
  const storeComputeSha256 = vi.fn().mockResolvedValue("a".repeat(64));
  vi.doMock("../../../infrastructure/s3/client", () => ({
    createS3DocumentStore: () => ({
      createMultipartUpload: storeCreateMultipartUpload,
      presignPartUrls: storePresignPartUrls,
      completeMultipartUpload: storeCompleteMultipartUpload,
      abortMultipartUpload: storeAbortMultipartUpload,
      presignDownloadUrl: storePresignDownloadUrl,
      headObject: storeHeadObject,
      deleteObject: storeDeleteObject,
      tagObject: storeTagObject,
      computeSha256: storeComputeSha256,
    }),
  }));

  // T-004: bootstrap reads that run BEFORE a tenant context exists —
  // `resolveActor`'s membership fallback, `/me`'s self-read of the
  // caller's own grants, and (unused by this test file, but stubbed
  // for completeness) the webhook's invitation lookup.
  const membershipFindByUser = vi.fn().mockResolvedValue(null);
  const grantListByUser = vi.fn().mockResolvedValue([]);
  vi.doMock("../../../infrastructure/db/bootstrapRepo", () => ({
    TenantBootstrapRepo: class {
      findMembershipForUser = membershipFindByUser;
      lockForUserCreate = vi.fn().mockResolvedValue(undefined);
      findInvitationByWorkosId = vi.fn();
      listGrantsForUser = grantListByUser;
      withTx = () => this;
    },
  }));

  // The application-layer audit module routes through `recordAuditEvent`
  // which then calls `AuditRepo.write`. Mock the audit module so we
  // don't have to round-trip through validation just to run a test.
  vi.doMock("../../audit", () => ({
    recordAuditEvent: auditWrite,
  }));

  return {
    authenticate,
    userFindById,
    userFindByWorkosUserId,
    userCreate,
    orgFindById,
    orgFindByWorkosOrgId,
    orgFindBySlug,
    orgCreate,
    membershipFindByOrgUser,
    membershipFindByUser,
    membershipCreate,
    grantListByUser,
    invitationCreate,
    invitationFindById,
    invitationListByOrgAndState,
    invitationTransitionState,
    auditWrite,
    auditListByOrg,
    workosCreateInvitation,
    workosRevokeInvitation,
    workosListSessions,
    workosRevokeSession,
    workosCreateOrganization,
    workosDeleteOrganization,
    opportunityCreate,
    opportunityFindById,
    opportunityFindBySlug,
    opportunityListActive,
    opportunityRename,
    opportunityArchive,
    documentCreate,
    documentFindById,
    documentFindActiveByName,
    documentGetWithCurrentVersion,
    documentListByCanonicalFolderWithVersion,
    documentListByOpportunityWithVersion,
    documentMarkActive,
    documentSetCurrentVersion,
    documentSoftDelete,
    documentRestore,
    documentPurgeDraft,
    versionCreate,
    versionFindById,
    versionListByDocument,
    versionLatestVersionNumber,
    grantRetargetOpportunitySlug,
    grantRevokeActiveForOpportunity,
    storeCreateMultipartUpload,
    storePresignPartUrls,
    storeCompleteMultipartUpload,
    storeAbortMultipartUpload,
    storePresignDownloadUrl,
    storeHeadObject,
    storeDeleteObject,
    storeTagObject,
    storeComputeSha256,
  };
}

async function loadProtectedRoutes() {
  const mod = await import("../protectedRoutes");
  return mod.protectedRoutes;
}

// Mirrors the production composition in `api.ts`: the top-level
// `orgRoutes` (with its create-org limiter) mounted alongside
// `protectedRoutes`. Used by the POST /orgs tests so the rate-limit
// isolation assertion exercises the real shape — proving the limiter
// can't leak onto `/me`.
async function loadOrgApp() {
  const { orgRoutes } = await import("../../orgs/orgRoutes");
  const { protectedRoutes } = await import("../protectedRoutes");
  return new Elysia().use(orgRoutes).use(protectedRoutes);
}

function makeRequest(
  path: string,
  init: RequestInit & { sessionCookie?: string } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.sessionCookie !== undefined) {
    headers.set("cookie", `wos_session=${init.sessionCookie}`);
  }
  headers.set("x-forwarded-for", "203.0.113.5");
  headers.set("user-agent", "test-agent");
  return new Request(`http://localhost${path}`, { ...init, headers });
}

describe("protectedRoutes", () => {
  let mocks: MockSetup;

  beforeEach(() => {
    vi.resetModules();
    mocks = setupMocks();
  });

  afterEach(() => {
    vi.doUnmock("sst");
    vi.doUnmock("@workos-inc/node");
    vi.doUnmock("@ai-data-room/db");
    vi.doUnmock("../../../infrastructure/db/userRepo");
    vi.doUnmock("../../../infrastructure/db/orgRepo");
    vi.doUnmock("../../../infrastructure/db/membershipRepo");
    vi.doUnmock("../../../infrastructure/db/externalGrantRepo");
    vi.doUnmock("../../../infrastructure/db/invitationRepo");
    vi.doUnmock("../../../infrastructure/db/auditRepo");
    vi.doUnmock("../../../infrastructure/db/bootstrapRepo");
    vi.doUnmock("../../audit");
    vi.doUnmock("../../../infrastructure/db/opportunityRepo");
    vi.doUnmock("../../../infrastructure/db/documentRepo");
    vi.doUnmock("../../../infrastructure/db/documentVersionRepo");
    vi.doUnmock("../../../infrastructure/db/documentDeletionRepo");
    vi.doUnmock("../../../infrastructure/s3/client");
  });

  describe("GET /me", () => {
    it("401 no_session when there's no session cookie", async () => {
      const routes = await loadProtectedRoutes();
      const res = await routes.handle(makeRequest("/me"));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, reason: "no_session" });
    });

    it("returns the FR14 shape for a fully-provisioned user (with org + membership)", async () => {
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.userFindById.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      mocks.orgFindById.mockResolvedValue(LOCAL_ORG);
      mocks.membershipFindByOrgUser.mockResolvedValue(OWNER_MEMBERSHIP);
      mocks.grantListByUser.mockResolvedValue([]);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest("/me", { sessionCookie: "sealed-blob" }),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        userId: LOCAL_USER_ID,
        email: SESSION_USER.email,
        fullName: "Alice Example",
        role: "owner",
        orgId: LOCAL_ORG_ID,
        orgName: LOCAL_ORG.name,
        opportunityScopes: [],
        emailVerified: true,
        mfaEnrolled: true,
        lifecycleState: "active",
      });
    });

    it("returns role:null + orgId:null for a freshly-signed-up unprovisioned user", async () => {
      // Fresh organic signup: WorkOS session has no organizationId,
      // local user mirror doesn't exist yet → resolveActor lazy-creates.
      mocks.authenticate.mockResolvedValue({
        authenticated: true,
        user: SESSION_USER,
        organizationId: null,
      });
      mocks.userFindByWorkosUserId.mockResolvedValueOnce(null);
      mocks.userCreate.mockResolvedValue(LOCAL_USER);
      mocks.userFindById.mockResolvedValue(LOCAL_USER);
      mocks.grantListByUser.mockResolvedValue([]);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest("/me", { sessionCookie: "sealed-blob" }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        userId: LOCAL_USER_ID,
        role: null,
        orgId: null,
        orgName: null,
      });
      expect(mocks.userCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          workosUserId: SESSION_USER.id,
          email: SESSION_USER.email,
          fullName: "Alice Example",
        }),
      );
    });

    it("reflects a just-created org via the membership fallback (T-004)", async () => {
      // Post-POST /orgs state: the sealed session still has no org
      // (organizationId null), but a membership now exists. resolveActor
      // falls back to it so /me flips from {orgId:null} to the new org.
      mocks.authenticate.mockResolvedValue({
        authenticated: true,
        user: SESSION_USER,
        organizationId: null,
      });
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.userFindById.mockResolvedValue(LOCAL_USER);
      mocks.membershipFindByUser.mockResolvedValue(OWNER_MEMBERSHIP);
      mocks.orgFindById.mockResolvedValue(LOCAL_ORG);
      mocks.membershipFindByOrgUser.mockResolvedValue(OWNER_MEMBERSHIP);
      mocks.grantListByUser.mockResolvedValue([]);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest("/me", { sessionCookie: "sealed-blob" }),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        orgId: LOCAL_ORG_ID,
        orgName: LOCAL_ORG.name,
        role: "owner",
      });
    });

    it("infers role='external' when an unprovisioned user has active grants", async () => {
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.userFindById.mockResolvedValue(LOCAL_USER);
      mocks.authenticate.mockResolvedValue({
        authenticated: true,
        user: SESSION_USER,
        organizationId: null,
      });
      mocks.grantListByUser.mockResolvedValue([
        {
          id: "g1",
          orgId: LOCAL_ORG_ID,
          userId: LOCAL_USER_ID,
          opportunitySlug: "vendor-a",
          grantedBy: LOCAL_USER_ID,
          status: "active",
          expiresAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest("/me", { sessionCookie: "sealed-blob" }),
      );

      const body = (await res.json()) as {
        role: string | null;
        opportunityScopes: string[];
      };
      expect(body.role).toBe("external");
      expect(body.opportunityScopes).toEqual(["vendor-a"]);
    });
  });

  describe("requireOrg gate", () => {
    it("403 no_org_membership on /orgs/:orgId/* when actor has no org", async () => {
      // Session has org, but the local org mirror is missing →
      // resolveActor sets localOrgId=null → requireOrg fires.
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(null);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/invitations`, {
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "no_org_membership",
      });
    });
  });

  describe("POST /orgs/:orgId/invitations", () => {
    function arrangeAuthorisedActor() {
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      mocks.orgFindById.mockResolvedValue(LOCAL_ORG);
      mocks.userFindById.mockResolvedValue(LOCAL_USER);
      mocks.membershipFindByOrgUser.mockResolvedValue(OWNER_MEMBERSHIP);
    }

    it("403 cross_org_access when paramOrgId mismatches the actor's localOrgId", async () => {
      arrangeAuthorisedActor();

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(
          // Actor's local org is LOCAL_ORG_ID; URL param is a
          // different valid UUID — the cross-org guard short-circuits.
          `/orgs/99999999-9999-4999-8999-999999999999/invitations`,
          {
            method: "POST",
            sessionCookie: "sealed-blob",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: "bob@example.com",
              kind: "internal",
              role: "viewer",
            }),
          },
        ),
      );

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "cross_org_access",
      });
    });

    it("creates an internal invitation on the happy path (201)", async () => {
      arrangeAuthorisedActor();
      mocks.workosCreateInvitation.mockResolvedValue({
        id: "wos_invite_id",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      mocks.invitationCreate.mockResolvedValue({
        id: INVITATION_ID,
        workosInvitationId: "wos_invite_id",
        orgId: LOCAL_ORG_ID,
        email: "bob@example.com",
        kind: "internal",
        role: "viewer",
        opportunitySlug: null,
        invitedBy: LOCAL_USER_ID,
        state: "pending",
        expiresAt: new Date(),
        acceptedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/invitations`, {
          method: "POST",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "bob@example.com",
            kind: "internal",
            role: "viewer",
          }),
        }),
      );

      expect(res.status).toBe(201);
      expect(mocks.workosCreateInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "bob@example.com",
          organizationId: LOCAL_ORG.workosOrgId,
          inviterUserId: LOCAL_USER.workosUserId,
          expiresInDays: 7,
        }),
      );
    });
  });

  describe("DELETE /orgs/:orgId/invitations/:id", () => {
    it("404 invitation_not_found when the invitation doesn't exist", async () => {
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      mocks.membershipFindByOrgUser.mockResolvedValue(OWNER_MEMBERSHIP);
      mocks.invitationFindById.mockResolvedValue(null);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/invitations/${INVITATION_ID}`, {
          method: "DELETE",
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "invitation_not_found",
      });
    });
  });

  describe("POST /orgs/:orgId/users/:userId/suspend", () => {
    it("409 self_suspension when the actor tries to suspend themselves", async () => {
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      mocks.membershipFindByOrgUser.mockResolvedValue(OWNER_MEMBERSHIP);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(
          // self-suspension: actor.localUserId === target.userId
          `/orgs/${LOCAL_ORG_ID}/users/${LOCAL_USER_ID}/suspend`,
          { method: "POST", sessionCookie: "sealed-blob" },
        ),
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "self_suspension",
      });
    });

    it("404 user_not_found when the target user doesn't exist locally", async () => {
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      mocks.membershipFindByOrgUser.mockResolvedValue(OWNER_MEMBERSHIP);
      // suspendUser's only `findById` call is the target lookup — if
      // it misses, the function throws SuspensionError("user_not_found")
      // before any other repo touch.
      mocks.userFindById.mockResolvedValue(null);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/users/${TARGET_USER_ID}/suspend`, {
          method: "POST",
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "user_not_found",
      });
    });
  });

  describe("GET /orgs/:orgId/audit-events", () => {
    it("returns an array on the happy path", async () => {
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      mocks.membershipFindByOrgUser.mockResolvedValue(OWNER_MEMBERSHIP);
      mocks.auditListByOrg.mockResolvedValue([
        {
          id: "evt_1",
          occurredAt: new Date(),
          eventType: "login_success",
          actorUserId: LOCAL_USER_ID,
          targetUserId: null,
          orgId: LOCAL_ORG_ID,
          sourceIp: "203.0.113.5",
          userAgent: "test",
          outcome: "success",
          metadata: {},
        },
      ]);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/audit-events`, {
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
    });

    it("400 incomplete_cursor when only one of (beforeOccurredAt, beforeId) is set", async () => {
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      mocks.membershipFindByOrgUser.mockResolvedValue(OWNER_MEMBERSHIP);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(
          `/orgs/${LOCAL_ORG_ID}/audit-events?beforeOccurredAt=2026-01-01T00:00:00Z`,
          { sessionCookie: "sealed-blob" },
        ),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "incomplete_cursor",
      });
    });

    it("400 invalid_cursor_timestamp when beforeOccurredAt is unparseable", async () => {
      // Without the in-handler guard, `new Date("not-a-date")` flows
      // into Drizzle's `lt()` and crashes at the SQL layer with a
      // 500. We want a 400 with a clear reason instead — same shape
      // as `incomplete_cursor` so the client can handle both
      // cursor-validation errors with one branch.
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      mocks.membershipFindByOrgUser.mockResolvedValue(OWNER_MEMBERSHIP);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(
          `/orgs/${LOCAL_ORG_ID}/audit-events?beforeOccurredAt=not-a-date&beforeId=88888888-8888-4888-8888-888888888888`,
          { sessionCookie: "sealed-blob" },
        ),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "invalid_cursor_timestamp",
      });
      // The auditRepo must NOT have been called — the bad cursor
      // should short-circuit before the query runs. Pinning this
      // explicitly so a future regression that lets the Invalid
      // Date through and crashes at the DB layer is caught here.
      expect(mocks.auditListByOrg).not.toHaveBeenCalled();
    });
  });

  describe("POST /orgs (org-provisioning)", () => {
    // A signed-in user with NO org yet (organizationId null →
    // localOrgId null after resolveActor).
    function arrangeNoOrgActor() {
      mocks.authenticate.mockResolvedValue({
        authenticated: true,
        user: SESSION_USER,
        organizationId: null,
      });
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.userFindById.mockResolvedValue(LOCAL_USER);
      mocks.membershipFindByUser.mockResolvedValue(null);
    }

    function postOrgs(app: Awaited<ReturnType<typeof loadOrgApp>>) {
      return app.handle(
        makeRequest("/orgs", {
          method: "POST",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Acme Ltd" }),
        }),
      );
    }

    it("creates an org (201) for a no-org user and returns {orgId, role}", async () => {
      arrangeNoOrgActor();
      const app = await loadOrgApp();
      const res = await postOrgs(app);

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ orgId: LOCAL_ORG_ID, role: "owner" });
      expect(mocks.workosCreateOrganization).toHaveBeenCalledWith({
        name: "Acme Ltd",
      });
    });

    it("409 already_in_org when the caller already belongs to an org", async () => {
      // Default session carries an org; resolveActor resolves localOrgId.
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.userFindById.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(LOCAL_ORG);

      const app = await loadOrgApp();
      const res = await postOrgs(app);

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "already_in_org",
      });
      expect(mocks.workosCreateOrganization).not.toHaveBeenCalled();
      // The fast-path rejection records the FR5 failure audit (and the
      // org.create.failures metric) like every other rejection — not a
      // silent 409.
      expect(mocks.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "org_created",
          outcome: "failure",
          metadata: expect.objectContaining({ reason: "already_in_org" }),
        }),
        expect.anything(),
      );
    });

    it("400 invalid_name for a blank (whitespace-only) name", async () => {
      arrangeNoOrgActor();
      const app = await loadOrgApp();
      const res = await app.handle(
        makeRequest("/orgs", {
          method: "POST",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "   " }),
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "invalid_name",
      });
      expect(mocks.workosCreateOrganization).not.toHaveBeenCalled();
    });

    it("500 provisioning_failed when createOrg fails (error → status mapping)", async () => {
      arrangeNoOrgActor();
      mocks.workosCreateOrganization.mockRejectedValue(
        new Error("workos down"),
      );

      const app = await loadOrgApp();
      const res = await postOrgs(app);

      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "provisioning_failed",
      });
    });

    it("rate-limits POST /orgs at 5/min/IP (NFR4)", async () => {
      arrangeNoOrgActor();
      const app = await loadOrgApp();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push((await postOrgs(app)).status);
      }
      // First 5 within budget (not rate-limited), 6th blocked.
      expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
      expect(statuses[5]).toBe(429);
    });

    it("the create-org limiter does NOT throttle GET /me (top-level isolation)", async () => {
      // Provisioned actor so /me returns 200. The composed app mirrors
      // production: orgRoutes (limiter) + protectedRoutes side by side.
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.userFindById.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      mocks.orgFindById.mockResolvedValue(LOCAL_ORG);
      mocks.membershipFindByOrgUser.mockResolvedValue(OWNER_MEMBERSHIP);

      const app = await loadOrgApp();
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) {
        statuses.push(
          (
            await app.handle(
              makeRequest("/me", { sessionCookie: "sealed-blob" }),
            )
          ).status,
        );
      }
      // 8 > the create-org limit of 5 — if the limiter leaked onto /me
      // these would start returning 429. They must not.
      expect(statuses.every((s) => s === 200)).toBe(true);
    });
  });

  describe("room-and-folders routes (T-011)", () => {
    function arrangeAuthorisedActor() {
      mocks.userFindByWorkosUserId.mockResolvedValue(LOCAL_USER);
      mocks.orgFindByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      mocks.orgFindById.mockResolvedValue(LOCAL_ORG);
      mocks.userFindById.mockResolvedValue(LOCAL_USER);
      mocks.membershipFindByOrgUser.mockResolvedValue(OWNER_MEMBERSHIP);
    }

    it("403 cross_org_access on GET /rooms when paramOrgId mismatches the actor's localOrgId", async () => {
      arrangeAuthorisedActor();

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/99999999-9999-4999-8999-999999999999/rooms`, {
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "cross_org_access",
      });
    });

    it("403 insufficient_role: a viewer cannot POST /opportunities (mutation)", async () => {
      // Pins the read-vs-mutation allowlist: room reads allow viewers
      // (ROOM_READ_ROLES) but mutations are owner/editor only. Guards
      // against future allowlist drift on the mutation routes.
      arrangeAuthorisedActor();
      mocks.membershipFindByOrgUser.mockResolvedValue({
        ...OWNER_MEMBERSHIP,
        role: "viewer" as const,
      });

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/opportunities`, {
          method: "POST",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "acme-corp" }),
        }),
      );

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "insufficient_role",
      });
      // The mutation never reached the application layer.
      expect(mocks.opportunityCreate).not.toHaveBeenCalled();
    });

    it("viewer CAN GET /rooms (read routes allow viewers)", async () => {
      arrangeAuthorisedActor();
      mocks.membershipFindByOrgUser.mockResolvedValue({
        ...OWNER_MEMBERSHIP,
        role: "viewer" as const,
      });
      mocks.opportunityListActive.mockResolvedValue([]);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/rooms`, {
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(200);
    });

    it("GET /rooms — 200 with folders + opportunities (FR7)", async () => {
      arrangeAuthorisedActor();
      mocks.opportunityListActive.mockResolvedValue([OPPORTUNITY]);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/rooms`, {
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        folders: string[];
        opportunities: Array<{ id: string }>;
      };
      expect(body.folders).toHaveLength(7);
      expect(body.opportunities).toHaveLength(1);
      expect(body.opportunities[0]).toMatchObject({ id: OPPORTUNITY_ID });
    });

    it("GET /rooms/folders/:canonical — 200 with the folder's documents", async () => {
      arrangeAuthorisedActor();
      mocks.documentListByCanonicalFolderWithVersion.mockResolvedValue([
        { document: DOCUMENT, currentVersion: DOCUMENT_VERSION },
      ]);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/rooms/folders/02_Financials`, {
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        documents: Array<{ id: string }>;
      };
      expect(body.documents).toHaveLength(1);
      expect(body.documents[0]).toMatchObject({ id: DOCUMENT_ID });
      expect(mocks.auditWrite).toHaveBeenCalled();
    });

    it("400 invalid_canonical_folder for an unknown :canonical segment", async () => {
      arrangeAuthorisedActor();

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/rooms/folders/not_a_real_folder`, {
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "invalid_canonical_folder",
      });
    });

    it("POST /opportunities — 201 on the happy path (FR4)", async () => {
      arrangeAuthorisedActor();
      mocks.opportunityCreate.mockResolvedValue(OPPORTUNITY);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/opportunities`, {
          method: "POST",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "vendor-a", name: "Vendor A" }),
        }),
      );

      expect(res.status).toBe(201);
      // Response is the client DTO (no internal orgId/createdBy/updatedAt;
      // createdAt as an ISO string) — `toEqual` locks that exact shape.
      expect(await res.json()).toEqual({
        id: OPPORTUNITY_ID,
        slug: "vendor-a",
        name: "Vendor A",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("GET /opportunities — 200 with the active list (FR7)", async () => {
      arrangeAuthorisedActor();
      mocks.opportunityListActive.mockResolvedValue([OPPORTUNITY]);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/opportunities`, {
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
    });

    it("GET /opportunities/:id/documents — 200 with the subroom's documents", async () => {
      arrangeAuthorisedActor();
      mocks.opportunityFindById.mockResolvedValue(OPPORTUNITY);
      mocks.documentListByOpportunityWithVersion.mockResolvedValue([
        {
          document: {
            ...DOCUMENT,
            folderKind: "opportunity" as const,
            canonicalFolder: null,
            opportunityId: OPPORTUNITY_ID,
          },
          currentVersion: DOCUMENT_VERSION,
        },
      ]);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(
          `/orgs/${LOCAL_ORG_ID}/opportunities/${OPPORTUNITY_ID}/documents`,
          { sessionCookie: "sealed-blob" },
        ),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        documents: Array<{ id: string }>;
      };
      expect(body.documents).toHaveLength(1);
    });

    it("404 folder_not_found on GET /opportunities/:id/documents for an unknown/archived subroom", async () => {
      arrangeAuthorisedActor();
      mocks.opportunityFindById.mockResolvedValue(null);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(
          `/orgs/${LOCAL_ORG_ID}/opportunities/${OPPORTUNITY_ID}/documents`,
          { sessionCookie: "sealed-blob" },
        ),
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "folder_not_found",
      });
    });

    it("PATCH /opportunities/:id — 200 on rename (FR5)", async () => {
      arrangeAuthorisedActor();
      // `renameOpportunity` reads the pre-rename row (inside its tx) to
      // detect a slug change before calling `.rename(...)`.
      mocks.opportunityFindById.mockResolvedValue(OPPORTUNITY);
      mocks.opportunityRename.mockResolvedValue({
        ...OPPORTUNITY,
        slug: "vendor-a-renamed",
      });

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/opportunities/${OPPORTUNITY_ID}`, {
          method: "PATCH",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "vendor-a-renamed" }),
        }),
      );

      expect(res.status).toBe(200);
      // Client DTO shape (no leaked internal columns).
      expect(await res.json()).toEqual({
        id: OPPORTUNITY_ID,
        slug: "vendor-a-renamed",
        name: "Vendor A",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("POST /opportunities/:id/archive — 200 on archive (FR6)", async () => {
      arrangeAuthorisedActor();
      // `archiveOpportunity` pre-checks the current row before the tx.
      mocks.opportunityFindById.mockResolvedValue(OPPORTUNITY);
      mocks.opportunityArchive.mockResolvedValue({
        ...OPPORTUNITY,
        status: "archived",
        archivedAt: new Date(),
      });
      mocks.grantRevokeActiveForOpportunity.mockResolvedValue(2);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(
          `/orgs/${LOCAL_ORG_ID}/opportunities/${OPPORTUNITY_ID}/archive`,
          { method: "POST", sessionCookie: "sealed-blob" },
        ),
      );

      expect(res.status).toBe(200);
      // Archive returns the bare client DTO (status flipped to "archived"),
      // NOT the internal `{ opportunity, grantsRevoked }` wrapper — the
      // revocation count is audit-only, never in the HTTP response.
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        id: OPPORTUNITY_ID,
        slug: "vendor-a",
        name: "Vendor A",
        status: "archived",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect(body).not.toHaveProperty("grantsRevoked");
    });

    it("GET /documents/:id — 200 with a presigned download URL (FR14)", async () => {
      arrangeAuthorisedActor();
      mocks.documentGetWithCurrentVersion.mockResolvedValue({
        document: DOCUMENT,
        currentVersion: DOCUMENT_VERSION,
      });

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/documents/${DOCUMENT_ID}`, {
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        document: { id: string };
        downloadUrl: string;
      };
      expect(body.document).toMatchObject({ id: DOCUMENT_ID });
      expect(body.downloadUrl).toBe("https://s3.example/download");
    });

    it("404 not_found on GET /documents/:id for an unknown document", async () => {
      arrangeAuthorisedActor();
      mocks.documentGetWithCurrentVersion.mockResolvedValue(null);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/documents/${DOCUMENT_ID}`, {
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "not_found",
      });
    });

    it("GET /documents/:id/versions — 200 with the version history (FR15)", async () => {
      arrangeAuthorisedActor();
      mocks.documentFindById.mockResolvedValue(DOCUMENT);
      mocks.versionListByDocument.mockResolvedValue([DOCUMENT_VERSION]);

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/documents/${DOCUMENT_ID}/versions`, {
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ id: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: VERSION_ID });
    });

    it("DELETE /documents/:id — 200 {ok:true} on soft-delete (FR17)", async () => {
      arrangeAuthorisedActor();
      mocks.documentFindById.mockResolvedValue(DOCUMENT);
      mocks.documentSoftDelete.mockResolvedValue({
        ...DOCUMENT,
        state: "soft_deleted",
      });

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/documents/${DOCUMENT_ID}`, {
          method: "DELETE",
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("409 invalid_state on DELETE /documents/:id for an already-deleted document", async () => {
      arrangeAuthorisedActor();
      mocks.documentFindById.mockResolvedValue({
        ...DOCUMENT,
        state: "soft_deleted",
      });

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/documents/${DOCUMENT_ID}`, {
          method: "DELETE",
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "invalid_state",
      });
    });

    it("POST /documents/:id/restore — 200 within the retention window (FR17)", async () => {
      arrangeAuthorisedActor();
      mocks.documentFindById.mockResolvedValue({
        ...DOCUMENT,
        state: "soft_deleted",
        softDeletedAt: new Date(),
      });
      mocks.documentRestore.mockResolvedValue({ ...DOCUMENT, state: "active" });

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/documents/${DOCUMENT_ID}/restore`, {
          method: "POST",
          sessionCookie: "sealed-blob",
        }),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("POST /uploads/initiate — 201 on the happy path (FR8-FR11)", async () => {
      arrangeAuthorisedActor();
      mocks.documentCreate.mockResolvedValue({ ...DOCUMENT, state: "draft" });

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/uploads/initiate`, {
          method: "POST",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: { kind: "canonical", folder: "02_Financials" },
            filename: "contract.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
          }),
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        documentId: string;
        parts: unknown[];
      };
      expect(body.documentId).toBe(DOCUMENT_ID);
      expect(body.parts).toHaveLength(1);
      expect(mocks.storeCreateMultipartUpload).toHaveBeenCalled();
    });

    it("POST /uploads/initiate — 201 targeting an Opportunity subroom", async () => {
      arrangeAuthorisedActor();
      mocks.opportunityFindById.mockResolvedValue(OPPORTUNITY);
      mocks.documentCreate.mockResolvedValue({
        ...DOCUMENT,
        folderKind: "opportunity" as const,
        canonicalFolder: null,
        opportunityId: OPPORTUNITY_ID,
        state: "draft" as const,
      });

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/uploads/initiate`, {
          method: "POST",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: { kind: "opportunity", opportunityId: OPPORTUNITY_ID },
            filename: "nda.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
          }),
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { documentId: string };
      expect(body.documentId).toBe(DOCUMENT_ID);
    });

    it("400 invalid_canonical_folder on POST /uploads/initiate for an unknown folder", async () => {
      arrangeAuthorisedActor();

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/uploads/initiate`, {
          method: "POST",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: { kind: "canonical", folder: "not_a_real_folder" },
            filename: "contract.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
          }),
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "invalid_canonical_folder",
      });
    });

    it("422 on POST /uploads/initiate for an unsupported mimeType (FR9)", async () => {
      arrangeAuthorisedActor();

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/uploads/initiate`, {
          method: "POST",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: { kind: "canonical", folder: "02_Financials" },
            filename: "malware.exe",
            mimeType: "application/x-msdownload",
            sizeBytes: 2048,
          }),
        }),
      );

      expect(res.status).toBe(422);
    });

    it("422 on POST /uploads/initiate when mimeType is missing (schema has no default)", async () => {
      // Guards the literal-union mimeType schema against a regression to a
      // defaulting form (e.g. `t.UnionEnum`, which injects a default that
      // silently coerces a MISSING value through as the first type) — a
      // missing mimeType must be rejected, never assumed.
      arrangeAuthorisedActor();

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/uploads/initiate`, {
          method: "POST",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: { kind: "canonical", folder: "02_Financials" },
            filename: "contract.pdf",
            sizeBytes: 2048,
          }),
        }),
      );

      expect(res.status).toBe(422);
    });

    it("POST /uploads/:uploadId/complete — 200 on the happy path", async () => {
      arrangeAuthorisedActor();
      mocks.documentFindById.mockResolvedValue({ ...DOCUMENT, state: "draft" });
      mocks.documentMarkActive.mockResolvedValue({
        ...DOCUMENT,
        state: "active",
      });

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/uploads/s3-upload-id/complete`, {
          method: "POST",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            documentId: DOCUMENT_ID,
            versionId: VERSION_ID,
            parts: [{ partNumber: 1, eTag: "etag-1" }],
          }),
        }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
      });
    });

    it("DELETE /uploads/:uploadId — 200 {ok:true} on abort", async () => {
      arrangeAuthorisedActor();
      mocks.documentFindById.mockResolvedValue({ ...DOCUMENT, state: "draft" });

      const routes = await loadProtectedRoutes();
      const res = await routes.handle(
        makeRequest(`/orgs/${LOCAL_ORG_ID}/uploads/s3-upload-id`, {
          method: "DELETE",
          sessionCookie: "sealed-blob",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            documentId: DOCUMENT_ID,
            versionId: VERSION_ID,
          }),
        }),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mocks.storeAbortMultipartUpload).toHaveBeenCalled();
      expect(mocks.documentPurgeDraft).toHaveBeenCalledWith(DOCUMENT_ID);
    });
  });
});
