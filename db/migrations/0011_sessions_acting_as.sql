ALTER TABLE "sessions" ADD COLUMN "acting_as_user_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "acting_as_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_acting_as_user_id_users_id_fk" FOREIGN KEY ("acting_as_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;