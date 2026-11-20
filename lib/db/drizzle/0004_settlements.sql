-- 0004_settlements: reimbursable expenses and "someone paid for me".
-- ADDITIVE ONLY. New enum types, a new counterparties table, nullable columns
-- (plus settlement_type NOT NULL DEFAULT 'none', a metadata-only change on
-- PostgreSQL 11+). Existing expenses become settlement_type = none and are not
-- otherwise touched. Safe to apply before the code deploy.
CREATE TYPE "public"."settlement_status" AS ENUM('pending', 'claimed', 'settled');--> statement-breakpoint
CREATE TYPE "public"."settlement_type" AS ENUM('none', 'reimbursable', 'paid_by_other');--> statement-breakpoint
CREATE TABLE "counterparties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counterparties_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_counterparty_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "settlement_type" "settlement_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "counterparty_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "settlement_status" "settlement_status";--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "settled_on" date;--> statement-breakpoint
CREATE INDEX "counterparties_status_idx" ON "counterparties" USING btree ("status");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_default_counterparty_id_counterparties_id_fk" FOREIGN KEY ("default_counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_settlement_idx" ON "expenses" USING btree ("settlement_type","settlement_status");--> statement-breakpoint
CREATE INDEX "expenses_counterparty_id_idx" ON "expenses" USING btree ("counterparty_id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_settlement_consistency_check" CHECK (("expenses"."settlement_type" = 'none' AND "expenses"."counterparty_id" IS NULL AND "expenses"."settlement_status" IS NULL AND "expenses"."settled_on" IS NULL)
        OR ("expenses"."settlement_type" <> 'none' AND "expenses"."counterparty_id" IS NOT NULL AND "expenses"."settlement_status" IS NOT NULL
            AND ("expenses"."settlement_status" = 'settled') = ("expenses"."settled_on" IS NOT NULL)
            AND ("expenses"."settlement_status" <> 'claimed' OR "expenses"."settlement_type" = 'reimbursable')));