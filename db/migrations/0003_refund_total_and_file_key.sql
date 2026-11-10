ALTER TABLE "payments" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "files_storage_key" ON "files" USING btree ("business_id","environment","storage_key");--> statement-breakpoint
-- Hand-added: fill the new running total for payments that already have refunds.
UPDATE "payments" p SET "refunded_cents" = COALESCE((SELECT SUM(r.amount_cents) FROM "refunds" r WHERE r.payment_id = p.id AND r.status = 'succeeded'), 0);
