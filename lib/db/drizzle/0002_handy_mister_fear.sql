-- ============================================================================
-- Stage 17: location dimension, hierarchical categories, transaction type.
--
-- Every statement here is additive. No table or column is dropped, no column
-- type is changed, and no existing expense row is modified except to populate
-- the new required location (all pre-existing spend is treated as India).
-- This migration is reversible by dropping the categories_single_level_hierarchy
-- trigger and categories_enforce_single_level_hierarchy function, then dropping
-- locations, expenses.location_id, expenses.transaction_type,
-- categories.parent_id and categories.slug.
-- ============================================================================

CREATE TYPE "public"."transaction_type" AS ENUM('expense', 'payment');
--> statement-breakpoint

CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"country_code" varchar(2),
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_name_unique" UNIQUE("name"),
	CONSTRAINT "locations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "locations_country_code_check" CHECK ("locations"."country_code" is null or "locations"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint

CREATE INDEX "locations_status_idx" ON "locations" USING btree ("status");
--> statement-breakpoint

-- Seed the locations needed by the expense backfill below. A country code is
-- metadata only: no currency is implied by a location.
INSERT INTO "locations" ("id", "name", "slug", "country_code", "status") VALUES
('10000000-0000-4000-a000-000000000001', 'India', 'india', 'IN', 'active'),
('10000000-0000-4000-a000-000000000002', 'Qatar', 'qatar', 'QA', 'active')
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint

-- --- categories: parent/child hierarchy -------------------------------------
-- Added as nullable first so existing rows are never rejected.
ALTER TABLE "categories" ADD COLUMN "slug" varchar(100);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "parent_id" uuid;
--> statement-breakpoint

-- Backfill slugs from existing names. A numeric suffix keeps them unique even
-- if two distinct names slugify to the same string.
WITH computed AS (
	SELECT
		"id",
		"created_at",
		COALESCE(NULLIF(trim(both '-' FROM lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'category') AS base
	FROM "categories"
), numbered AS (
	SELECT
		"id",
		base,
		(row_number() OVER (PARTITION BY base ORDER BY "created_at", "id") - 1)::int AS dup
	FROM computed
)
UPDATE "categories" AS c
SET "slug" = CASE WHEN n.dup = 0 THEN n.base ELSE n.base || '-' || n.dup::text END
FROM numbered AS n
WHERE c."id" = n."id";
--> statement-breakpoint

ALTER TABLE "categories" ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "categories" ADD CONSTRAINT "categories_slug_unique" UNIQUE("slug");
--> statement-breakpoint

ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_not_self_check" CHECK ("categories"."parent_id" is null or "categories"."parent_id" <> "categories"."id");
--> statement-breakpoint

ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");
--> statement-breakpoint

-- The hierarchy is exactly one level deep: a category that already has a parent
-- may not itself become a parent. A CHECK constraint cannot look at another
-- row, so this is enforced with a trigger as well as in the API layer.
CREATE OR REPLACE FUNCTION "categories_enforce_single_level_hierarchy"()
RETURNS trigger AS $$
DECLARE
	parent_parent_id uuid;
BEGIN
	IF NEW."parent_id" IS NULL THEN
		RETURN NEW;
	END IF;

	SELECT "parent_id" INTO parent_parent_id
	FROM "categories"
	WHERE "id" = NEW."parent_id";

	IF parent_parent_id IS NOT NULL THEN
		RAISE EXCEPTION 'Category % cannot sit under % because that category already has a parent',
			NEW."id", NEW."parent_id";
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "categories_single_level_hierarchy"
BEFORE INSERT OR UPDATE OF "parent_id" ON "categories"
FOR EACH ROW EXECUTE FUNCTION "categories_enforce_single_level_hierarchy"();
--> statement-breakpoint

-- Re-stamp any existing row whose parent is itself nested, so the invariant
-- holds for data written before this trigger existed.
UPDATE "categories" AS child
SET "parent_id" = NULL
WHERE child."parent_id" IS NOT NULL
  AND EXISTS (
	SELECT 1 FROM "categories" AS parent
	WHERE parent."id" = child."parent_id" AND parent."parent_id" IS NOT NULL
  );
--> statement-breakpoint

-- --- expenses: location + transaction type ----------------------------------
-- Added as nullable so existing rows are never rejected, then backfilled.
ALTER TABLE "expenses" ADD COLUMN "location_id" uuid;
--> statement-breakpoint

-- All pre-existing spend predates the Qatar move, so it belongs to India.
-- Done explicitly in SQL rather than in application code.
UPDATE "expenses"
SET "location_id" = '10000000-0000-4000-a000-000000000001'
WHERE "location_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "expenses" ALTER COLUMN "location_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "expenses_location_id_idx" ON "expenses" USING btree ("location_id");
--> statement-breakpoint

-- Safe to add NOT NULL with a default: existing rows receive 'expense'.
ALTER TABLE "expenses" ADD COLUMN "transaction_type" "transaction_type" DEFAULT 'expense' NOT NULL;
--> statement-breakpoint

CREATE INDEX "expenses_transaction_type_idx" ON "expenses" USING btree ("transaction_type");