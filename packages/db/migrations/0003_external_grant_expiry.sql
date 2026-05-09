ALTER TYPE "public"."external_grant_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TABLE "external_access_grants" ADD COLUMN "expires_at" timestamp with time zone DEFAULT NOW() + INTERVAL '90 days' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eag_expires_at_idx" ON "external_access_grants" USING btree ("expires_at");