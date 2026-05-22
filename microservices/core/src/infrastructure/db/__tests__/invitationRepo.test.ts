// Unit test for InvitationRepo behaviour that's hard to assert
// against real Postgres — specifically the `auth.invite.expired`
// metric fan-out in `transitionState`. The full SQL contract
// (atomic compare-and-set, TOCTOU race) is proven in the integration
// suite; this file targets the side-effect (metric emit) that fires
// only when the transition target is `expired`.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MetricUnit } from "@aws-lambda-powertools/metrics";

import { metrics } from "../../observability/metrics";
import { InvitationRepo } from "../invitationRepo";
import type { DbOrTx } from "@ai-data-room/db";

function makeDbReturning(rows: unknown[]): DbOrTx {
  // Minimal stub mirroring Drizzle's fluent chain on `update`.
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
  return {
    update: vi.fn().mockReturnValue(chain),
  } as unknown as DbOrTx;
}

describe("InvitationRepo.transitionState — metric fan-out", () => {
  beforeEach(() => {
    vi.spyOn(metrics, "addMetric").mockReturnValue(metrics);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits auth.invite.expired when a row transitions to expired", async () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      state: "expired",
    };
    const repo = new InvitationRepo(makeDbReturning([row]));

    await repo.transitionState(row.id, "pending", "expired");

    expect(metrics.addMetric).toHaveBeenCalledWith(
      "auth.invite.expired",
      MetricUnit.Count,
      1,
    );
  });

  it("does NOT emit auth.invite.expired for accepted / revoked transitions", async () => {
    const row = { id: "abc", state: "accepted" };
    const repo = new InvitationRepo(makeDbReturning([row]));

    await repo.transitionState(row.id, "pending", "accepted");

    expect(metrics.addMetric).not.toHaveBeenCalledWith(
      "auth.invite.expired",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does NOT emit auth.invite.expired when the compare-and-set finds no rows (race lost)", async () => {
    // Defends the `result &&` guard — a null result must skip the
    // metric, otherwise we'd over-count "expired" transitions on
    // every concurrent attempt.
    const repo = new InvitationRepo(makeDbReturning([]));

    await repo.transitionState("missing-id", "pending", "expired");

    expect(metrics.addMetric).not.toHaveBeenCalled();
  });
});
