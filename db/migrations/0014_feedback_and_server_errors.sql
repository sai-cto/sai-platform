CREATE TABLE "server_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"digest" text,
	"path" text,
	"stack" text,
	"user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"message" text NOT NULL,
	"page_url" text DEFAULT '' NOT NULL,
	"author_name" text DEFAULT '' NOT NULL,
	"author_email" text,
	"status" text DEFAULT 'new' NOT NULL,
	CONSTRAINT "feedback_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_errors_occurred_idx" ON "server_errors" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "feedback_scope_idx" ON "feedback" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "feedback_created_idx" ON "feedback" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE POLICY "feedback_read" ON "feedback" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "feedback_write" ON "feedback" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));