-- Reverse of `0004_role_vocab_rename.sql`. Run by hand
-- (`psql $DATABASE_URL -f ...`); drizzle's migrator never sees this
-- file. After applying, delete the matching row from
-- `drizzle.__drizzle_migrations` so the next forward `migrate` re-runs
-- the up file.
--
-- Renames the role enum values back to the shipped slice-1 vocabulary
-- (`editor`→`admin`, `viewer`→`internal`). Non-destructive, same as the
-- up migration. Leaves `invitation_kind` untouched.

ALTER TYPE "public"."org_role" RENAME VALUE 'editor' TO 'admin';
ALTER TYPE "public"."org_role" RENAME VALUE 'viewer' TO 'internal';
ALTER TYPE "public"."invitation_role" RENAME VALUE 'editor' TO 'admin';
ALTER TYPE "public"."invitation_role" RENAME VALUE 'viewer' TO 'internal';
