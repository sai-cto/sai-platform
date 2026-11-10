CREATE TYPE "public"."business_role" AS ENUM('business_admin', 'business_staff');--> statement-breakpoint
CREATE TYPE "public"."environment" AS ENUM('live', 'sandbox');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('super_admin', 'tech', 'executive');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"actor_role" text NOT NULL,
	"business_id" uuid,
	"environment" "environment" DEFAULT 'live' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_subject" UNIQUE("provider","provider_subject")
);
--> statement-breakpoint
CREATE TABLE "business_modules" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"module_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"staff_portal_enabled" boolean DEFAULT true NOT NULL,
	"customer_portal_enabled" boolean DEFAULT false NOT NULL,
	"field_portal_enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"accent_color" text NOT NULL,
	"secondary_color" text,
	"time_zone" text DEFAULT 'America/New_York' NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_slug_unique" UNIQUE("slug"),
	CONSTRAINT "businesses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"business_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_key_business" UNIQUE NULLS NOT DISTINCT("key","business_id")
);
--> statement-breakpoint
CREATE TABLE "membership_permissions" (
	"membership_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "membership_permissions_membership_id_permission_key_pk" PRIMARY KEY("membership_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"role" "business_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_business" UNIQUE("user_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"platform_role" "platform_role",
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"customer_id" uuid,
	"kind" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'unconfirmed' NOT NULL,
	"resource_id" uuid,
	"subject_type" text,
	"subject_id" uuid,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"kind" text DEFAULT 'person' NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"organization_name" text,
	"email" text,
	"phone" text,
	"notes" text,
	"external_ref" text
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"subject_type" text,
	"subject_id" uuid
);
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"entity_key" text NOT NULL,
	"filename" text NOT NULL,
	"file_id" uuid,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fingerprint" text DEFAULT '' NOT NULL,
	"completed_on" date
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"channel" text DEFAULT 'email' NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"adapter" text NOT NULL,
	"error" text,
	"subject_type" text,
	"subject_id" uuid
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"customer_id" uuid,
	"kind" text DEFAULT 'charge' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text NOT NULL,
	"method" text DEFAULT 'card' NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"idempotency_key" text,
	"card_brand" text,
	"card_last4" text,
	"failure_reason" text,
	"description" text DEFAULT '' NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"payment_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"provider_ref" text
);
--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "unavailability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"resource_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unavailability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_modules" ADD CONSTRAINT "business_modules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_permissions" ADD CONSTRAINT "membership_permissions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailability" ADD CONSTRAINT "unavailability_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailability" ADD CONSTRAINT "unavailability_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_business_idx" ON "activity_log" USING btree ("business_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_log_entity_idx" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "activity_log_occurred_idx" ON "activity_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "memberships_business_idx" ON "memberships" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "appointments_scope_idx" ON "appointments" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "appointments_time_idx" ON "appointments" USING btree ("business_id","environment","starts_at");--> statement-breakpoint
CREATE INDEX "customers_scope_idx" ON "customers" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("business_id","email");--> statement-breakpoint
CREATE INDEX "files_scope_idx" ON "files" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "import_jobs_scope_idx" ON "import_jobs" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "notifications_scope_idx" ON "notifications" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "payments_scope_idx" ON "payments" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "payments_subject_idx" ON "payments" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "payments_paid_idx" ON "payments" USING btree ("business_id","environment","paid_at");--> statement-breakpoint
CREATE INDEX "refunds_scope_idx" ON "refunds" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "resources_scope_idx" ON "resources" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "unavailability_scope_idx" ON "unavailability" USING btree ("business_id","environment");--> statement-breakpoint
CREATE POLICY "activity_log_read" ON "activity_log" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or business_id = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "activity_log_insert" ON "activity_log" AS PERMISSIVE FOR INSERT TO "sai_app" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "appointments_read" ON "appointments" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "appointments_write" ON "appointments" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "customers_read" ON "customers" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "customers_write" ON "customers" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "files_read" ON "files" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "files_write" ON "files" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "import_jobs_read" ON "import_jobs" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "import_jobs_write" ON "import_jobs" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "notifications_read" ON "notifications" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "notifications_write" ON "notifications" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "payments_read" ON "payments" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "payments_write" ON "payments" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "refunds_read" ON "refunds" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "refunds_write" ON "refunds" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "resources_read" ON "resources" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "resources_write" ON "resources" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "unavailability_read" ON "unavailability" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "unavailability_write" ON "unavailability" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));