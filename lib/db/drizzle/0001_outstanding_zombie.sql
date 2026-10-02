CREATE TABLE "currencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(3) NOT NULL,
	"name" varchar(80) NOT NULL,
	"symbol" varchar(8) NOT NULL,
	"decimal_places" integer DEFAULT 2 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currencies_code_unique" UNIQUE("code"),
	CONSTRAINT "currencies_code_check" CHECK ("currencies"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "currencies_decimal_places_check" CHECK ("currencies"."decimal_places" >= 0 and "currencies"."decimal_places" <= 4)
);
--> statement-breakpoint
CREATE INDEX "currencies_is_active_idx" ON "currencies" USING btree ("is_active");
--> statement-breakpoint
INSERT INTO "currencies" ("id", "code", "name", "symbol", "decimal_places", "is_active") VALUES
('c0de0000-0000-4000-a000-000000000001', 'INR', 'Indian Rupee', '₹', 2, true),
('c0de0000-0000-4000-a000-000000000002', 'QAR', 'Qatari Riyal', '﷼', 2, true),
('c0de0000-0000-4000-a000-000000000003', 'AED', 'UAE Dirham', 'د.إ', 2, true),
('c0de0000-0000-4000-a000-000000000004', 'USD', 'US Dollar', '$', 2, true),
('c0de0000-0000-4000-a000-000000000005', 'EUR', 'Euro', '€', 2, true),
('c0de0000-0000-4000-a000-000000000006', 'GBP', 'British Pound', '£', 2, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_currency_id" uuid;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "currency_id" uuid;
--> statement-breakpoint
UPDATE "projects" SET "default_currency_id" = 'c0de0000-0000-4000-a000-000000000001' WHERE "default_currency_id" IS NULL;
--> statement-breakpoint
UPDATE "expenses" SET "currency_id" = 'c0de0000-0000-4000-a000-000000000001' WHERE "currency_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "default_currency_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "currency_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_default_currency_id_currencies_id_fk" FOREIGN KEY ("default_currency_id") REFERENCES "public"."currencies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "projects_default_currency_id_idx" ON "projects" USING btree ("default_currency_id");
--> statement-breakpoint
CREATE INDEX "expenses_currency_id_idx" ON "expenses" USING btree ("currency_id");