-- Slice 17 / T-000 — role-vocabulary migration (ADR-012 / RB-7).
--
-- Renames the shipped role enum values to the design's `identity.js`
-- vocabulary: `admin`→`editor`, `internal`→`viewer`. Touches the
-- `org_role` and `invitation_role` enums only — the `invitation_kind`
-- category (`internal`/`external`) is orthogonal and left untouched.
--
-- HAND-AUTHORED, replacing drizzle-kit's generated drop/recreate.
-- drizzle-kit cannot emit `ALTER TYPE ... RENAME VALUE` (it diffs enum
-- changes as DROP TYPE + CREATE TYPE). The generated form is also
-- *incorrect* for any populated table: it recreates the enum without
-- the old labels, then casts existing `'admin'`/`'internal'` rows to an
-- enum that no longer contains them — which errors. `RENAME VALUE` is
-- non-destructive: columns using the enum reflect the new labels
-- automatically, with no column-type juggling and no data rewrite.
--
-- The committed snapshot (`meta/0004_snapshot.json`) still reflects the
-- new label set drizzle-kit produced, so the CI drift check (which
-- diffs schema↔snapshot, not SQL) stays green. See `migrations/README.md`
-- for the hand-edit policy and `0004_role_vocab_rename.down.sql` for the
-- paired manual reverse migration.

ALTER TYPE "public"."org_role" RENAME VALUE 'admin' TO 'editor';--> statement-breakpoint
ALTER TYPE "public"."org_role" RENAME VALUE 'internal' TO 'viewer';--> statement-breakpoint
ALTER TYPE "public"."invitation_role" RENAME VALUE 'admin' TO 'editor';--> statement-breakpoint
ALTER TYPE "public"."invitation_role" RENAME VALUE 'internal' TO 'viewer';
