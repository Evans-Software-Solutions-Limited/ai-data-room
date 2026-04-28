-- Reverse of `0001_postgres_specific_constraints.sql`. Run by hand
-- (`psql $DATABASE_URL -f ...`); drizzle's migrator never sees this
-- file. After applying, delete the matching row from
-- `drizzle.__drizzle_migrations` so the next forward `migrate` re-runs
-- the up file. Order matters: indexes first, then the column types,
-- then the extension — the ALTER back to text is non-destructive
-- because citext implicit-casts to text.

DROP INDEX IF EXISTS "users_email_active_key";
DROP INDEX IF EXISTS "org_memberships_single_owner_key";
ALTER TABLE "users" ALTER COLUMN "email" SET DATA TYPE text;
ALTER TABLE "invitations" ALTER COLUMN "email" SET DATA TYPE text;
-- Only safe to drop the extension if no other table or index depends on
-- citext. Slice 1 owns the only two consumers (`users.email`,
-- `invitations.email`); revisit this line if a later slice picks up
-- citext. `RESTRICT` will refuse the drop and surface the conflict if
-- so.
DROP EXTENSION IF EXISTS "citext" RESTRICT;
