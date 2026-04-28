-- Slice 1 / T-005 — Postgres-specific DDL drizzle-kit can't emit.
--
-- Drizzle-kit generated the four ALTER + CREATE INDEX statements below
-- from the schema delta (citext columns + two partial unique indexes).
-- The only hand-addition is the `CREATE EXTENSION` line at the top:
-- drizzle-kit doesn't emit extension-creation statements, so without
-- it the `ALTER COLUMN ... TYPE citext` calls would fail with
-- "type citext does not exist".
--
-- See `migrations/README.md` for the policy on hand-edits, and
-- `0001_postgres_specific_constraints.down.sql` for the manual reverse
-- migration paired with this file.

CREATE EXTENSION IF NOT EXISTS "citext";--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "email" SET DATA TYPE citext;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" SET DATA TYPE citext;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_memberships_single_owner_key" ON "org_memberships" USING btree ("org_id") WHERE role = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_active_key" ON "users" USING btree ("email") WHERE lifecycle_state <> 'deleted';
