-- Managers (Nov 2026): the Cornellian discount is $20 per labor hour (estimate builder), not 5%.
-- Archive the old percentage discount in every existing business environment so a customer
-- cannot get both. Archived, not deleted: it stays visible (and restorable) in the Data tab.
UPDATE "hhmc_discounts" SET "archived_at" = now() WHERE "name" = 'Cornellian' AND "archived_at" IS NULL;
