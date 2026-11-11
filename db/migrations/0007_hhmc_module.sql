CREATE TABLE "hhmc_automation_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"rule_id" uuid NOT NULL,
	"lead_id" uuid,
	"job_id" uuid,
	"estimate_id" uuid,
	"invoice_id" uuid,
	"payment_id" uuid,
	"recipient" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"sent_at" timestamp with time zone,
	"cancelled_reason" text,
	"notification_id" uuid,
	CONSTRAINT "hhmc_automation_queue_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_automation_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"template_key" text NOT NULL,
	"respects_opt_in" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "hhmc_automation_rules_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_automation_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"section" text NOT NULL,
	"unit" text NOT NULL,
	"rate_cents" integer NOT NULL,
	"is_default_for_local" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "hhmc_catalog_items_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_catalog_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"name" text NOT NULL,
	"percent_bp" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "hhmc_discounts_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_discounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"job_id" uuid NOT NULL,
	"estimate_number" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"service_tax_cents" integer NOT NULL,
	"convenience_fee_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"deposit_cents" integer NOT NULL,
	"sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"valuation_initials" text,
	"signature_name" text,
	"signed_ip" text,
	"signed_user_agent" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"deposit_payment_id" uuid,
	"deposit_paid_cents" integer DEFAULT 0 NOT NULL,
	"document_file_id" uuid,
	CONSTRAINT "hhmc_estimates_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_estimates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"invoice_id" uuid NOT NULL,
	"section" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"qty_hundredths" integer NOT NULL,
	"rate_cents" integer NOT NULL,
	"discount_type" text,
	"discount_value" integer,
	"service_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "hhmc_invoice_lines_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"invoice_number" text NOT NULL,
	"job_id" uuid NOT NULL,
	"estimate_id" uuid,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"terms" text DEFAULT 'due_on_receipt' NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"po_number" text,
	"service_tax_on" boolean DEFAULT false NOT NULL,
	"convenience_fee_on" boolean DEFAULT false NOT NULL,
	"service_tax_bp" integer NOT NULL,
	"convenience_fee_bp" integer NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"service_tax_cents" integer DEFAULT 0 NOT NULL,
	"convenience_fee_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"deposit_received_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"remarks" text,
	CONSTRAINT "hhmc_invoices_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_job_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"job_id" uuid NOT NULL,
	"day_date" date NOT NULL,
	"start_time" text DEFAULT '08:00' NOT NULL,
	"duration_minutes" integer DEFAULT 240 NOT NULL,
	"crew_size" integer NOT NULL,
	"trucks" integer NOT NULL,
	"notes" text,
	"actual_minutes" integer,
	CONSTRAINT "hhmc_job_days_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_job_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"job_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"lead_id" uuid,
	"company_name" text,
	"po_number" text,
	"origin_address" text,
	"destination_address" text,
	"extra_stops" text[] DEFAULT '{}'::text[] NOT NULL,
	"move_date" date,
	"tentative" boolean DEFAULT false NOT NULL,
	"arrival_window" text,
	"service_type" text DEFAULT 'local' NOT NULL,
	"job_type" text NOT NULL,
	"bedrooms" text,
	"crew_size" integer DEFAULT 2 NOT NULL,
	"trucks" integer DEFAULT 1 NOT NULL,
	"customer_comments" text,
	"scope_of_work" text,
	"internal_notes" text,
	"owner_name" text,
	"coordinators" text[] DEFAULT '{}'::text[] NOT NULL,
	"rating" text,
	"automation_opt_in" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'Other' NOT NULL,
	"source_detail" text,
	"stage" text DEFAULT 'qualified' NOT NULL,
	"lost_reason" text,
	"cancelled_reason" text,
	"booked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "hhmc_jobs_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"lead_number" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"email" text,
	"phone" text,
	"source" text DEFAULT 'Other' NOT NULL,
	"source_detail" text,
	"move_date" date,
	"move_type" text DEFAULT 'residential' NOT NULL,
	"storage" boolean DEFAULT false NOT NULL,
	"bedrooms" text,
	"origin_address" text,
	"destination_address" text,
	"owner_name" text,
	"rating" text,
	"customer_note" text,
	"internal_note" text,
	"status" text DEFAULT 'new' NOT NULL,
	"disqualified_reason" text,
	"disqualified_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"customer_id" uuid,
	"no_contact_started_at" timestamp with time zone,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"gclid" text,
	"fbclid" text,
	CONSTRAINT "hhmc_leads_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"job_id" uuid,
	"lead_id" uuid,
	"kind" text NOT NULL,
	"call_outcome" text,
	"body" text DEFAULT '' NOT NULL,
	"author_name" text DEFAULT '' NOT NULL,
	CONSTRAINT "hhmc_notes_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"quote_id" uuid NOT NULL,
	"section" text NOT NULL,
	"catalog_item_id" uuid,
	"name" text NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"qty_hundredths" integer NOT NULL,
	"rate_cents" integer NOT NULL,
	"discount_type" text,
	"discount_value" integer,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "hhmc_quote_lines_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_quote_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"job_id" uuid NOT NULL,
	"service_tax_on" boolean DEFAULT false NOT NULL,
	"convenience_fee_on" boolean DEFAULT true NOT NULL,
	CONSTRAINT "hhmc_quotes_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hhmc_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "hhmc_templates_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "hhmc_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hhmc_automation_queue" ADD CONSTRAINT "hhmc_automation_queue_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_automation_queue" ADD CONSTRAINT "hhmc_queue_rule_fk" FOREIGN KEY ("business_id","environment","rule_id") REFERENCES "public"."hhmc_automation_rules"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_automation_queue" ADD CONSTRAINT "hhmc_queue_lead_fk" FOREIGN KEY ("business_id","environment","lead_id") REFERENCES "public"."hhmc_leads"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_automation_queue" ADD CONSTRAINT "hhmc_queue_job_fk" FOREIGN KEY ("business_id","environment","job_id") REFERENCES "public"."hhmc_jobs"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_automation_queue" ADD CONSTRAINT "hhmc_queue_estimate_fk" FOREIGN KEY ("business_id","environment","estimate_id") REFERENCES "public"."hhmc_estimates"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_automation_queue" ADD CONSTRAINT "hhmc_queue_invoice_fk" FOREIGN KEY ("business_id","environment","invoice_id") REFERENCES "public"."hhmc_invoices"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_automation_queue" ADD CONSTRAINT "hhmc_queue_payment_fk" FOREIGN KEY ("business_id","environment","payment_id") REFERENCES "public"."payments"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_automation_queue" ADD CONSTRAINT "hhmc_queue_notification_fk" FOREIGN KEY ("business_id","environment","notification_id") REFERENCES "public"."notifications"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_automation_rules" ADD CONSTRAINT "hhmc_automation_rules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_catalog_items" ADD CONSTRAINT "hhmc_catalog_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_discounts" ADD CONSTRAINT "hhmc_discounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_estimates" ADD CONSTRAINT "hhmc_estimates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_estimates" ADD CONSTRAINT "hhmc_estimates_job_fk" FOREIGN KEY ("business_id","environment","job_id") REFERENCES "public"."hhmc_jobs"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_estimates" ADD CONSTRAINT "hhmc_estimates_payment_fk" FOREIGN KEY ("business_id","environment","deposit_payment_id") REFERENCES "public"."payments"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_estimates" ADD CONSTRAINT "hhmc_estimates_file_fk" FOREIGN KEY ("business_id","environment","document_file_id") REFERENCES "public"."files"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_invoice_lines" ADD CONSTRAINT "hhmc_invoice_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_invoice_lines" ADD CONSTRAINT "hhmc_invoice_lines_invoice_fk" FOREIGN KEY ("business_id","environment","invoice_id") REFERENCES "public"."hhmc_invoices"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_invoices" ADD CONSTRAINT "hhmc_invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_invoices" ADD CONSTRAINT "hhmc_invoices_job_fk" FOREIGN KEY ("business_id","environment","job_id") REFERENCES "public"."hhmc_jobs"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_invoices" ADD CONSTRAINT "hhmc_invoices_estimate_fk" FOREIGN KEY ("business_id","environment","estimate_id") REFERENCES "public"."hhmc_estimates"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_invoices" ADD CONSTRAINT "hhmc_invoices_customer_fk" FOREIGN KEY ("business_id","environment","customer_id") REFERENCES "public"."customers"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_job_days" ADD CONSTRAINT "hhmc_job_days_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_job_days" ADD CONSTRAINT "hhmc_job_days_job_fk" FOREIGN KEY ("business_id","environment","job_id") REFERENCES "public"."hhmc_jobs"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD CONSTRAINT "hhmc_jobs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD CONSTRAINT "hhmc_jobs_customer_fk" FOREIGN KEY ("business_id","environment","customer_id") REFERENCES "public"."customers"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD CONSTRAINT "hhmc_jobs_lead_fk" FOREIGN KEY ("business_id","environment","lead_id") REFERENCES "public"."hhmc_leads"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_leads" ADD CONSTRAINT "hhmc_leads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_leads" ADD CONSTRAINT "hhmc_leads_customer_fk" FOREIGN KEY ("business_id","environment","customer_id") REFERENCES "public"."customers"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_notes" ADD CONSTRAINT "hhmc_notes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_notes" ADD CONSTRAINT "hhmc_notes_job_fk" FOREIGN KEY ("business_id","environment","job_id") REFERENCES "public"."hhmc_jobs"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_notes" ADD CONSTRAINT "hhmc_notes_lead_fk" FOREIGN KEY ("business_id","environment","lead_id") REFERENCES "public"."hhmc_leads"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_quote_lines" ADD CONSTRAINT "hhmc_quote_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_quote_lines" ADD CONSTRAINT "hhmc_quote_lines_quote_fk" FOREIGN KEY ("business_id","environment","quote_id") REFERENCES "public"."hhmc_quotes"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_quote_lines" ADD CONSTRAINT "hhmc_quote_lines_item_fk" FOREIGN KEY ("business_id","environment","catalog_item_id") REFERENCES "public"."hhmc_catalog_items"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_quotes" ADD CONSTRAINT "hhmc_quotes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_quotes" ADD CONSTRAINT "hhmc_quotes_job_fk" FOREIGN KEY ("business_id","environment","job_id") REFERENCES "public"."hhmc_jobs"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hhmc_templates" ADD CONSTRAINT "hhmc_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hhmc_automation_queue_scope_idx" ON "hhmc_automation_queue" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "hhmc_queue_due_idx" ON "hhmc_automation_queue" USING btree ("business_id","environment","status","due_at");--> statement-breakpoint
CREATE INDEX "hhmc_automation_rules_scope_idx" ON "hhmc_automation_rules" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "hhmc_automation_rules_key" ON "hhmc_automation_rules" USING btree ("business_id","environment","key") WHERE "hhmc_automation_rules"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "hhmc_catalog_items_scope_idx" ON "hhmc_catalog_items" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "hhmc_discounts_scope_idx" ON "hhmc_discounts" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "hhmc_estimates_scope_idx" ON "hhmc_estimates" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "hhmc_estimates_number" ON "hhmc_estimates" USING btree ("business_id","environment","estimate_number","version");--> statement-breakpoint
CREATE UNIQUE INDEX "hhmc_estimates_version" ON "hhmc_estimates" USING btree ("business_id","environment","job_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "hhmc_estimates_one_live" ON "hhmc_estimates" USING btree ("business_id","environment","job_id") WHERE "hhmc_estimates"."status" in ('sent', 'viewed', 'signed') and "hhmc_estimates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "hhmc_invoice_lines_scope_idx" ON "hhmc_invoice_lines" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "hhmc_invoices_scope_idx" ON "hhmc_invoices" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "hhmc_invoices_number" ON "hhmc_invoices" USING btree ("business_id","environment","invoice_number");--> statement-breakpoint
CREATE INDEX "hhmc_job_days_scope_idx" ON "hhmc_job_days" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "hhmc_jobs_scope_idx" ON "hhmc_jobs" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "hhmc_jobs_number" ON "hhmc_jobs" USING btree ("business_id","environment","job_number");--> statement-breakpoint
CREATE INDEX "hhmc_jobs_stage_idx" ON "hhmc_jobs" USING btree ("business_id","environment","stage");--> statement-breakpoint
CREATE INDEX "hhmc_leads_scope_idx" ON "hhmc_leads" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "hhmc_leads_number" ON "hhmc_leads" USING btree ("business_id","environment","lead_number");--> statement-breakpoint
CREATE INDEX "hhmc_notes_scope_idx" ON "hhmc_notes" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "hhmc_quote_lines_scope_idx" ON "hhmc_quote_lines" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "hhmc_quotes_scope_idx" ON "hhmc_quotes" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "hhmc_quotes_one_per_job" ON "hhmc_quotes" USING btree ("business_id","environment","job_id");--> statement-breakpoint
CREATE INDEX "hhmc_templates_scope_idx" ON "hhmc_templates" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "hhmc_templates_key" ON "hhmc_templates" USING btree ("business_id","environment","key") WHERE "hhmc_templates"."archived_at" is null;--> statement-breakpoint
CREATE POLICY "hhmc_automation_queue_read" ON "hhmc_automation_queue" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_automation_queue_write" ON "hhmc_automation_queue" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_automation_rules_read" ON "hhmc_automation_rules" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_automation_rules_write" ON "hhmc_automation_rules" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_catalog_items_read" ON "hhmc_catalog_items" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_catalog_items_write" ON "hhmc_catalog_items" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_discounts_read" ON "hhmc_discounts" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_discounts_write" ON "hhmc_discounts" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_estimates_read" ON "hhmc_estimates" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_estimates_write" ON "hhmc_estimates" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_invoice_lines_read" ON "hhmc_invoice_lines" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_invoice_lines_write" ON "hhmc_invoice_lines" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_invoices_read" ON "hhmc_invoices" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_invoices_write" ON "hhmc_invoices" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_job_days_read" ON "hhmc_job_days" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_job_days_write" ON "hhmc_job_days" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_jobs_read" ON "hhmc_jobs" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_jobs_write" ON "hhmc_jobs" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_leads_read" ON "hhmc_leads" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_leads_write" ON "hhmc_leads" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_notes_read" ON "hhmc_notes" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_notes_write" ON "hhmc_notes" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_quote_lines_read" ON "hhmc_quote_lines" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_quote_lines_write" ON "hhmc_quote_lines" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_quotes_read" ON "hhmc_quotes" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_quotes_write" ON "hhmc_quotes" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "hhmc_templates_read" ON "hhmc_templates" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "hhmc_templates_write" ON "hhmc_templates" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));