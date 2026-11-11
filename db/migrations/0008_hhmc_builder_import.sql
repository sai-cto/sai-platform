CREATE TABLE "hhmc_import_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"source" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"entity_key" text NOT NULL,
	"record_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hhmc_import_refs_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_import_refs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hhmc_estimates" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "distance_tenths" integer;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "drive_minutes" integer;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "distance_source" text;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "own_truck" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "cornellian" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "origin_access" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "destination_access" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "origin_notes" text;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "destination_notes" text;--> statement-breakpoint
ALTER TABLE "hhmc_import_refs" ADD CONSTRAINT "hhmc_import_refs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hhmc_import_refs_scope_idx" ON "hhmc_import_refs" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "hhmc_import_refs_source" ON "hhmc_import_refs" USING btree ("business_id","environment","source","source_type","source_id") WHERE "hhmc_import_refs"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "hhmc_import_refs_record_idx" ON "hhmc_import_refs" USING btree ("business_id","environment","record_id");--> statement-breakpoint
CREATE POLICY "hhmc_import_refs_read" ON "hhmc_import_refs" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_import_refs_write" ON "hhmc_import_refs" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));