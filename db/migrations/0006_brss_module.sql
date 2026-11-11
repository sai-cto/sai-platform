CREATE TABLE "brss_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"appointment_id" uuid NOT NULL,
	"order_id" uuid,
	"type" text NOT NULL,
	"region_id" uuid,
	"building_id" uuid,
	"address1" text,
	"address2" text,
	"room" text,
	"city" text,
	"state" text DEFAULT 'New York' NOT NULL,
	"zip" text,
	"has_elevator" boolean DEFAULT false NOT NULL,
	"phone" text,
	"estimated_boxes" integer DEFAULT 0 NOT NULL,
	"estimated_other_items" integer DEFAULT 0 NOT NULL,
	"packing_hours" integer DEFAULT 0 NOT NULL,
	"override_reason" text,
	"crew" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "brss_appointments_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"article_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"product_id" uuid,
	"weight_lb" integer DEFAULT 0 NOT NULL,
	"length_in" integer DEFAULT 0 NOT NULL,
	"width_in" integer DEFAULT 0 NOT NULL,
	"height_in" integer DEFAULT 0 NOT NULL,
	"billable_weight_lb" integer DEFAULT 0 NOT NULL,
	"status" text,
	"additional_insurance_cents" integer DEFAULT 0 NOT NULL,
	"other_storage_price_cents" integer,
	"warehouse_id" uuid,
	"section" text,
	"row" text,
	"pallet" integer,
	CONSTRAINT "brss_articles_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_block_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"unavailability_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	CONSTRAINT "brss_block_buildings_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_block_buildings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"region_id" uuid NOT NULL,
	"name" text NOT NULL,
	"campus_category" text NOT NULL,
	CONSTRAINT "brss_buildings_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_buildings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_order_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"order_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"cornell_shipping_account" boolean DEFAULT false NOT NULL,
	"received_from_zip" text,
	CONSTRAINT "brss_order_articles_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_order_articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"article_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"payment_id" uuid,
	"rule" text,
	CONSTRAINT "brss_order_items_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"order_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"services" text[] NOT NULL,
	"campus_category" text,
	"net_id" text,
	"storage_term_months" integer,
	"storage_effective_date" date,
	"ship_to_name" text,
	"ship_to_address1" text,
	"ship_to_address2" text,
	"ship_to_city" text,
	"ship_to_state" text,
	"ship_to_zip" text,
	"ship_to_zone" integer,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	CONSTRAINT "brss_orders_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_products" (
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
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"role" text,
	"unit_price_cents" integer NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "brss_products_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_regions" (
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
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "brss_regions_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_regions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_storage_term_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"term_months" integer NOT NULL,
	"is_overweight" boolean DEFAULT false NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "brss_storage_term_products_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_storage_term_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_truck_crew" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"truck_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "brss_truck_crew_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_truck_crew" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_warehouses" (
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
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "brss_warehouses_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_warehouses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_zip_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"zip_low" integer NOT NULL,
	"zip_high" integer NOT NULL,
	"zone" integer NOT NULL,
	CONSTRAINT "brss_zip_zones_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_zip_zones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brss_zone_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"zone" integer NOT NULL,
	"weight_lb" integer NOT NULL,
	"ship_home_cents" integer DEFAULT 0 NOT NULL,
	"ship_cornell_cents" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "brss_zone_rates_tenant_id" UNIQUE("business_id","environment","id")
);
--> statement-breakpoint
ALTER TABLE "brss_zone_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brss_appointments" ADD CONSTRAINT "brss_appointments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_appointments" ADD CONSTRAINT "brss_appointments_appointment_fk" FOREIGN KEY ("business_id","environment","appointment_id") REFERENCES "public"."appointments"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_appointments" ADD CONSTRAINT "brss_appointments_order_fk" FOREIGN KEY ("business_id","environment","order_id") REFERENCES "public"."brss_orders"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_appointments" ADD CONSTRAINT "brss_appointments_region_fk" FOREIGN KEY ("business_id","environment","region_id") REFERENCES "public"."brss_regions"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_appointments" ADD CONSTRAINT "brss_appointments_building_fk" FOREIGN KEY ("business_id","environment","building_id") REFERENCES "public"."brss_buildings"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_articles" ADD CONSTRAINT "brss_articles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_articles" ADD CONSTRAINT "brss_articles_customer_fk" FOREIGN KEY ("business_id","environment","customer_id") REFERENCES "public"."customers"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_articles" ADD CONSTRAINT "brss_articles_product_fk" FOREIGN KEY ("business_id","environment","product_id") REFERENCES "public"."brss_products"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_articles" ADD CONSTRAINT "brss_articles_warehouse_fk" FOREIGN KEY ("business_id","environment","warehouse_id") REFERENCES "public"."brss_warehouses"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_block_buildings" ADD CONSTRAINT "brss_block_buildings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_block_buildings" ADD CONSTRAINT "brss_block_buildings_block_fk" FOREIGN KEY ("business_id","environment","unavailability_id") REFERENCES "public"."unavailability"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_block_buildings" ADD CONSTRAINT "brss_block_buildings_building_fk" FOREIGN KEY ("business_id","environment","building_id") REFERENCES "public"."brss_buildings"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_buildings" ADD CONSTRAINT "brss_buildings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_buildings" ADD CONSTRAINT "brss_buildings_region_fk" FOREIGN KEY ("business_id","environment","region_id") REFERENCES "public"."brss_regions"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_order_articles" ADD CONSTRAINT "brss_order_articles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_order_articles" ADD CONSTRAINT "brss_order_articles_order_fk" FOREIGN KEY ("business_id","environment","order_id") REFERENCES "public"."brss_orders"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_order_articles" ADD CONSTRAINT "brss_order_articles_article_fk" FOREIGN KEY ("business_id","environment","article_id") REFERENCES "public"."brss_articles"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_order_items" ADD CONSTRAINT "brss_order_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_order_items" ADD CONSTRAINT "brss_order_items_order_fk" FOREIGN KEY ("business_id","environment","order_id") REFERENCES "public"."brss_orders"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_order_items" ADD CONSTRAINT "brss_order_items_product_fk" FOREIGN KEY ("business_id","environment","product_id") REFERENCES "public"."brss_products"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_order_items" ADD CONSTRAINT "brss_order_items_article_fk" FOREIGN KEY ("business_id","environment","article_id") REFERENCES "public"."brss_articles"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_order_items" ADD CONSTRAINT "brss_order_items_payment_fk" FOREIGN KEY ("business_id","environment","payment_id") REFERENCES "public"."payments"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_orders" ADD CONSTRAINT "brss_orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_orders" ADD CONSTRAINT "brss_orders_customer_fk" FOREIGN KEY ("business_id","environment","customer_id") REFERENCES "public"."customers"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_products" ADD CONSTRAINT "brss_products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_regions" ADD CONSTRAINT "brss_regions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_storage_term_products" ADD CONSTRAINT "brss_storage_term_products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_storage_term_products" ADD CONSTRAINT "brss_storage_terms_product_fk" FOREIGN KEY ("business_id","environment","product_id") REFERENCES "public"."brss_products"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_truck_crew" ADD CONSTRAINT "brss_truck_crew_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_truck_crew" ADD CONSTRAINT "brss_truck_crew_truck_fk" FOREIGN KEY ("business_id","environment","truck_id") REFERENCES "public"."resources"("business_id","environment","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_warehouses" ADD CONSTRAINT "brss_warehouses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_zip_zones" ADD CONSTRAINT "brss_zip_zones_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brss_zone_rates" ADD CONSTRAINT "brss_zone_rates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brss_appointments_scope_idx" ON "brss_appointments" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "brss_appointments_one_per_appointment" ON "brss_appointments" USING btree ("business_id","environment","appointment_id");--> statement-breakpoint
CREATE INDEX "brss_articles_scope_idx" ON "brss_articles" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "brss_articles_number" ON "brss_articles" USING btree ("business_id","environment","article_number");--> statement-breakpoint
CREATE INDEX "brss_block_buildings_scope_idx" ON "brss_block_buildings" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "brss_buildings_scope_idx" ON "brss_buildings" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "brss_order_articles_scope_idx" ON "brss_order_articles" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "brss_order_articles_pair" ON "brss_order_articles" USING btree ("business_id","environment","order_id","article_id") WHERE "brss_order_articles"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "brss_order_items_scope_idx" ON "brss_order_items" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "brss_orders_scope_idx" ON "brss_orders" USING btree ("business_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "brss_orders_number" ON "brss_orders" USING btree ("business_id","environment","order_number");--> statement-breakpoint
CREATE INDEX "brss_products_scope_idx" ON "brss_products" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "brss_regions_scope_idx" ON "brss_regions" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "brss_storage_term_products_scope_idx" ON "brss_storage_term_products" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "brss_truck_crew_scope_idx" ON "brss_truck_crew" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "brss_warehouses_scope_idx" ON "brss_warehouses" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "brss_zip_zones_scope_idx" ON "brss_zip_zones" USING btree ("business_id","environment");--> statement-breakpoint
CREATE INDEX "brss_zone_rates_scope_idx" ON "brss_zone_rates" USING btree ("business_id","environment");--> statement-breakpoint
CREATE POLICY "brss_appointments_read" ON "brss_appointments" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_appointments_write" ON "brss_appointments" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_articles_read" ON "brss_articles" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_articles_write" ON "brss_articles" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_block_buildings_read" ON "brss_block_buildings" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_block_buildings_write" ON "brss_block_buildings" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_buildings_read" ON "brss_buildings" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_buildings_write" ON "brss_buildings" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_order_articles_read" ON "brss_order_articles" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_order_articles_write" ON "brss_order_articles" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_order_items_read" ON "brss_order_items" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_order_items_write" ON "brss_order_items" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_orders_read" ON "brss_orders" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_orders_write" ON "brss_orders" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_products_read" ON "brss_products" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_products_write" ON "brss_products" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_regions_read" ON "brss_regions" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_regions_write" ON "brss_regions" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_storage_term_products_read" ON "brss_storage_term_products" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_storage_term_products_write" ON "brss_storage_term_products" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_truck_crew_read" ON "brss_truck_crew" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_truck_crew_write" ON "brss_truck_crew" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_warehouses_read" ON "brss_warehouses" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_warehouses_write" ON "brss_warehouses" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_zip_zones_read" ON "brss_zip_zones" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_zip_zones_write" ON "brss_zip_zones" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));--> statement-breakpoint
CREATE POLICY "brss_zone_rates_read" ON "brss_zone_rates" AS PERMISSIVE FOR SELECT TO "sai_app" USING (current_setting('app.scope', true) = 'platform' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)));--> statement-breakpoint
CREATE POLICY "brss_zone_rates_write" ON "brss_zone_rates" AS PERMISSIVE FOR ALL TO "sai_app" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true));