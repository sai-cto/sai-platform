CREATE INDEX "hhmc_queue_job_idx" ON "hhmc_automation_queue" USING btree ("business_id","job_id");--> statement-breakpoint
CREATE INDEX "hhmc_queue_lead_idx" ON "hhmc_automation_queue" USING btree ("business_id","lead_id");--> statement-breakpoint
CREATE INDEX "hhmc_estimates_job_idx" ON "hhmc_estimates" USING btree ("business_id","job_id");--> statement-breakpoint
CREATE INDEX "hhmc_estimates_sent_idx" ON "hhmc_estimates" USING btree ("business_id","sent_at");--> statement-breakpoint
CREATE INDEX "hhmc_invoice_lines_invoice_idx" ON "hhmc_invoice_lines" USING btree ("business_id","invoice_id");--> statement-breakpoint
CREATE INDEX "hhmc_invoices_job_idx" ON "hhmc_invoices" USING btree ("business_id","job_id");--> statement-breakpoint
CREATE INDEX "hhmc_invoices_customer_idx" ON "hhmc_invoices" USING btree ("business_id","customer_id");--> statement-breakpoint
CREATE INDEX "hhmc_job_days_job_idx" ON "hhmc_job_days" USING btree ("business_id","job_id");--> statement-breakpoint
CREATE INDEX "hhmc_job_days_day_idx" ON "hhmc_job_days" USING btree ("business_id","day_date");--> statement-breakpoint
CREATE INDEX "hhmc_jobs_customer_idx" ON "hhmc_jobs" USING btree ("business_id","customer_id");--> statement-breakpoint
CREATE INDEX "hhmc_jobs_lead_idx" ON "hhmc_jobs" USING btree ("business_id","lead_id");--> statement-breakpoint
CREATE INDEX "hhmc_jobs_move_date_idx" ON "hhmc_jobs" USING btree ("business_id","move_date");--> statement-breakpoint
CREATE INDEX "hhmc_leads_customer_idx" ON "hhmc_leads" USING btree ("business_id","customer_id");--> statement-breakpoint
CREATE INDEX "hhmc_notes_job_idx" ON "hhmc_notes" USING btree ("business_id","job_id");--> statement-breakpoint
CREATE INDEX "hhmc_notes_lead_idx" ON "hhmc_notes" USING btree ("business_id","lead_id");--> statement-breakpoint
CREATE INDEX "hhmc_quote_lines_quote_idx" ON "hhmc_quote_lines" USING btree ("business_id","quote_id");--> statement-breakpoint
CREATE INDEX "hhmc_quotes_job_idx" ON "hhmc_quotes" USING btree ("business_id","job_id");