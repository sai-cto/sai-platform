ALTER TABLE "hhmc_estimates" ADD COLUMN "signed_terms_version" text;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "service_type_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- Existing work requests keep the service type they were given (by staff or the import); new ones follow their addresses.
ALTER TABLE "hhmc_jobs" ALTER COLUMN "service_type_source" SET DEFAULT 'auto';--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "suggested_service_type" text;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "route_states" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "hhmc_jobs" ADD COLUMN "route_checked" boolean DEFAULT false NOT NULL;