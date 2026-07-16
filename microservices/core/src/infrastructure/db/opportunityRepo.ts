// Drizzle-backed repository for the `opportunities` aggregate.
//
// room-and-folders (slice 2) / T-004. Extends `ScopedRepo` per the
// tenant-isolation contract (ADR-011): every read routes through
// `this.scoped(opportunities.orgId, …)` and every write stamps the
// bound org via `stampOrgId`. Constructed only by the `scopedRepo`
// factory (`scoped.ts`) — the CI tripwire
// (`security/__tests__/tenancy-guard.test.ts`) bans raw access to
// `opportunities` anywhere outside this allowlisted file.
//
// Backs the opportunity CRUD application layer (T-006): create / rename
// / archive / list subrooms (FR4–FR6).

import { and, asc, eq, lt } from "drizzle-orm";
import type { Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type { Opportunity } from "@ai-data-room/api-utils/schemas/rooms";

import { ScopedRepo } from "./scopedRepoBase";
import { firstOrNull } from "./_helpers";

const { opportunities } = schema;

export interface CreateOpportunityInput {
  slug: string;
  name: string;
  createdBy: string;
}

export interface RenameOpportunityInput {
  slug: string;
  name: string;
}

export class OpportunityRepo extends ScopedRepo {
  withTx(tx: Tx): OpportunityRepo {
    return new OpportunityRepo(tx, this.orgId);
  }

  /**
   * Inserts a new Opportunity subroom into the bound org (FR4). The
   * `(org_id, slug)` unique index rejects a duplicate slug within the
   * org; the application layer catches that and translates it to a
   * domain error. `status` defaults to `active` at the DB.
   */
  async create(input: CreateOpportunityInput): Promise<Opportunity> {
    const [row] = await this.db
      .insert(opportunities)
      .values(this.stampOrgId(input))
      .returning();
    return row as Opportunity;
  }

  /** Look up an opportunity by id within the bound org. A foreign-org
   *  id resolves to `null` — the isolation guarantee (indistinguishable
   *  from "doesn't exist"). */
  async findById(id: string): Promise<Opportunity | null> {
    const rows = await this.db
      .select()
      .from(opportunities)
      .where(this.scoped(opportunities.orgId, eq(opportunities.id, id)));
    return firstOrNull(rows as Opportunity[]);
  }

  /** Look up an opportunity by slug within the bound org (FR4 uniqueness
   *  is per-org). Used by the create path to give a clean "name taken"
   *  error before hitting the unique-index exception. */
  async findBySlug(slug: string): Promise<Opportunity | null> {
    const rows = await this.db
      .select()
      .from(opportunities)
      .where(this.scoped(opportunities.orgId, eq(opportunities.slug, slug)));
    return firstOrNull(rows as Opportunity[]);
  }

  /** Live subrooms for nav (design GET /opportunities), ordered by slug.
   *  Served by the partial `where status='active'` index. */
  async listActive(): Promise<Opportunity[]> {
    const rows = await this.db
      .select()
      .from(opportunities)
      .where(
        this.scoped(opportunities.orgId, eq(opportunities.status, "active")),
      )
      .orderBy(asc(opportunities.slug));
    return rows as Opportunity[];
  }

  /**
   * Rename an Opportunity (FR5) — slug + display name. Preserves all
   * documents and grants (they reference the id, not the slug). Returns
   * the updated row, or `null` if the id is unknown / belongs to a
   * foreign org, so the handler can return 404 rather than 500.
   */
  async rename(
    id: string,
    input: RenameOpportunityInput,
  ): Promise<Opportunity | null> {
    const rows = await this.db
      .update(opportunities)
      .set({ slug: input.slug, name: input.name, updatedAt: new Date() })
      .where(this.scoped(opportunities.orgId, eq(opportunities.id, id)))
      .returning();
    return firstOrNull(rows as Opportunity[]);
  }

  /**
   * Archive an Opportunity (FR6): flips `status` to `archived` and
   * stamps `archived_at` (starts the 90-day retention clock swept in
   * T-010). Compare-and-set on `status='active'` so a re-archive is a
   * no-op that returns `null` (also `null` for a foreign-org id).
   * Revoking the related external grants is the application layer's job
   * (T-006, cross-slice call into access-control).
   */
  async archive(
    id: string,
    at: Date = new Date(),
  ): Promise<Opportunity | null> {
    const rows = await this.db
      .update(opportunities)
      .set({ status: "archived", archivedAt: at, updatedAt: at })
      .where(
        this.scoped(
          opportunities.orgId,
          and(eq(opportunities.id, id), eq(opportunities.status, "active")),
        ),
      )
      .returning();
    return firstOrNull(rows as Opportunity[]);
  }

  /**
   * Archived subrooms whose retention window has elapsed
   * (`archived_at < cutoff`), for the T-010 retention sweep. Scoped to
   * the bound org — the sweep runs one `systemScope(orgId, …)` per org,
   * there is no all-orgs handle.
   */
  async listArchivedBefore(cutoff: Date): Promise<Opportunity[]> {
    const rows = await this.db
      .select()
      .from(opportunities)
      .where(
        this.scoped(
          opportunities.orgId,
          and(
            eq(opportunities.status, "archived"),
            lt(opportunities.archivedAt, cutoff),
          ),
        ),
      );
    return rows as Opportunity[];
  }
}
