// Drizzle-backed repository for the `organizations` aggregate.
//
// Slice 1 / T-007. Conventions per `userRepo.ts`. Used by the signup
// callback (T-008) to find-or-create an org for the first internal
// user, and by `/me` (T-015) to look up the active session's org.

import { eq } from "drizzle-orm";
import type { DbOrTx, Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type { Org } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { firstOrNull } from "./_helpers";

const { organizations } = schema;

export interface CreateOrgInput {
  workosOrgId: string;
  name: string;
  slug: string;
}

export class OrgRepo {
  private readonly db: DbOrTx;
  constructor(db: DbOrTx) {
    this.db = db;
  }

  withTx(tx: Tx): OrgRepo {
    return new OrgRepo(tx);
  }

  async create(input: CreateOrgInput): Promise<Org> {
    const [row] = await this.db.insert(organizations).values(input).returning();
    return row as Org;
  }

  async findById(id: string): Promise<Org | null> {
    const rows = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id));
    return firstOrNull(rows as Org[]);
  }

  /**
   * Find-or-create primary key for the signup callback. WorkOS Org IDs
   * are stable; the unique index on `workos_org_id` makes this O(1).
   */
  async findByWorkosOrgId(workosOrgId: string): Promise<Org | null> {
    const rows = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.workosOrgId, workosOrgId));
    return firstOrNull(rows as Org[]);
  }

  /**
   * Slug lookups support the URL-routing surface (e.g. /orgs/:slug
   * shortcuts in the admin dashboard). Slug is unique and lowercase
   * per the zod schema (T-004).
   */
  async findBySlug(slug: string): Promise<Org | null> {
    const rows = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug));
    return firstOrNull(rows as Org[]);
  }
}
