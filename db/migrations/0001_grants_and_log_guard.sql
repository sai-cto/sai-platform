-- Custom migration (hand-written). Two jobs:
--
-- 1. Give the restricted app role (sai_app) access to tables. It can read and write rows,
--    but row-level security decides WHICH rows, and it owns nothing, so it cannot bypass it.
--    Default privileges make every table created by later migrations follow the same rule,
--    so a new module's tables need no extra grant.
GRANT USAGE ON SCHEMA public TO sai_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sai_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sai_app;--> statement-breakpoint

-- 2. Make the activity log append-only.
--    a) the app role may only INSERT and SELECT
REVOKE UPDATE, DELETE, TRUNCATE ON activity_log FROM sai_app;--> statement-breakpoint
--    b) and even the owner role is stopped by a trigger
CREATE OR REPLACE FUNCTION activity_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER activity_log_no_update_or_delete
  BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_log_is_append_only();--> statement-breakpoint
CREATE TRIGGER activity_log_no_truncate
  BEFORE TRUNCATE ON activity_log
  FOR EACH STATEMENT EXECUTE FUNCTION activity_log_is_append_only();
