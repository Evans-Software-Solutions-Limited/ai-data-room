// Unit tests for `requireOrg`. The guard is a synchronous,
// dependency-free reader of `actor.localOrgId` — no mocks needed.

import { describe, expect, it } from "vitest";

import { requireOrg } from "../requireOrg";

describe("requireOrg", () => {
  it("passes through (returns undefined) when localOrgId is set", () => {
    const result = requireOrg({
      actor: { localUserId: "uid", localOrgId: "oid" },
    });
    expect(result).toBeUndefined();
  });

  it("returns 403 no_org_membership when localOrgId is null", () => {
    const result = requireOrg({
      actor: { localUserId: "uid", localOrgId: null },
    });
    // 403, NOT 401 — the request IS authenticated, the user just
    // hasn't been provisioned into an org. 401 would imply "sign in"
    // as the recovery path, which is wrong: signing in again puts
    // them right back here.
    expect(result).toMatchObject({
      code: 403,
      response: { ok: false, reason: "no_org_membership" },
    });
  });
});
