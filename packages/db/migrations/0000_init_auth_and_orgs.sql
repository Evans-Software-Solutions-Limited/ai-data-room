CREATE TYPE "public"."audit_outcome" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."external_grant_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."invitation_kind" AS ENUM('internal', 'external');--> statement-breakpoint
CREATE TYPE "public"."invitation_role" AS ENUM('admin', 'internal');--> statement-breakpoint
CREATE TYPE "public"."invitation_state" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'internal');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."user_lifecycle_state" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid,
	"org_id" uuid,
	"source_ip" "inet",
	"user_agent" text,
	"outcome" "audit_outcome" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"opportunity_slug" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"status" "external_grant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workos_invitation_id" text NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"kind" "invitation_kind" NOT NULL,
	"role" "invitation_role",
	"opportunity_slug" text,
	"invited_by" uuid NOT NULL,
	"state" "invitation_state" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workos_org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "org_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workos_user_id" text NOT NULL,
	"email" text,
	"full_name" text,
	"lifecycle_state" "user_lifecycle_state" DEFAULT 'active' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"mfa_enrolled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_access_grants" ADD CONSTRAINT "external_access_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_access_grants" ADD CONSTRAINT "external_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_access_grants" ADD CONSTRAINT "external_access_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_org_time_idx" ON "audit_events" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_actor_time_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_target_time_idx" ON "audit_events" USING btree ("target_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_type_time_idx" ON "audit_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eag_org_opportunity_idx" ON "external_access_grants" USING btree ("org_id","opportunity_slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eag_user_idx" ON "external_access_grants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_workos_invitation_id_key" ON "invitations" USING btree ("workos_invitation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitations_org_state_idx" ON "invitations" USING btree ("org_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_memberships_org_user_key" ON "org_memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_workos_org_id_key" ON "organizations" USING btree ("workos_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_key" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_workos_user_id_key" ON "users" USING btree ("workos_user_id");