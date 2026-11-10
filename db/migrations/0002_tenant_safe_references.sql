-- Tenant-safe references. (Statements reordered by hand: the UNIQUE constraints must exist
-- before the composite foreign keys that point at them.)
--
-- Every link between two tenant tables now includes business_id and environment, so the
-- database guarantees a row can only point at a row of the SAME business and the SAME
-- environment. Links never cascade: deleting a row something still points at is refused.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_resource_id_resources_id_fk";--> statement-breakpoint
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_payment_id_payments_id_fk";--> statement-breakpoint
ALTER TABLE "unavailability" DROP CONSTRAINT "unavailability_resource_id_resources_id_fk";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id" UNIQUE("business_id","environment","id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id" UNIQUE("business_id","environment","id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id" UNIQUE("business_id","environment","id");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id" UNIQUE("business_id","environment","id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id" UNIQUE("business_id","environment","id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id" UNIQUE("business_id","environment","id");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id" UNIQUE("business_id","environment","id");--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_tenant_id" UNIQUE("business_id","environment","id");--> statement-breakpoint
ALTER TABLE "unavailability" ADD CONSTRAINT "unavailability_tenant_id" UNIQUE("business_id","environment","id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_fk" FOREIGN KEY ("business_id","environment","customer_id") REFERENCES "public"."customers"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_resource_fk" FOREIGN KEY ("business_id","environment","resource_id") REFERENCES "public"."resources"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_file_fk" FOREIGN KEY ("business_id","environment","file_id") REFERENCES "public"."files"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_fk" FOREIGN KEY ("business_id","environment","customer_id") REFERENCES "public"."customers"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_fk" FOREIGN KEY ("business_id","environment","payment_id") REFERENCES "public"."payments"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailability" ADD CONSTRAINT "unavailability_resource_fk" FOREIGN KEY ("business_id","environment","resource_id") REFERENCES "public"."resources"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key" ON "payments" USING btree ("business_id","environment","idempotency_key") WHERE "payments"."idempotency_key" is not null;
--> statement-breakpoint
-- The app role never deletes platform records (people are deactivated, memberships are
-- switched off, sessions are revoked), so take the privilege away.
REVOKE DELETE, TRUNCATE ON users, businesses, business_modules, memberships, platform_settings, auth_identities, sessions FROM sai_app;
