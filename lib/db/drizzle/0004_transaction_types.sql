CREATE TYPE "transaction_type_kind" AS ENUM('expense', 'payment');
--> statement-breakpoint
CREATE TABLE "transaction_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(80) NOT NULL,
  "slug" varchar(80) NOT NULL,
  -- Why a type carries a kind: every spending total in this app is defined as
  -- "expense kinds", because a bill payment settles a debt rather than being
  -- new consumption. Without this column a reader could add a type that counts
  -- as neither, and every total would silently drop it. With it, a new type
  -- joins an existing bucket the moment it is created.
  "kind" "transaction_type_kind" NOT NULL,
  "status" "record_status" NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "transaction_types_name_unique" UNIQUE("name"),
  CONSTRAINT "transaction_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "transaction_types" ("id", "name", "slug", "kind") VALUES
  ('50000000-0000-4000-a000-000000000001', 'Expense', 'expense', 'expense'),
  ('50000000-0000-4000-a000-000000000002', 'Payment', 'payment', 'payment');
--> statement-breakpoint
CREATE INDEX "transaction_types_status_idx" ON "transaction_types" ("status");
--> statement-breakpoint
-- Expand only: the existing enum column stays and keeps its values, and the new
-- foreign key is added alongside it. Reporting switches to the foreign key in
-- application code; the enum column is dropped in a later release once nothing
-- reads it, so this migration can be deployed without any window where the old
-- and new code disagree.
ALTER TABLE "expenses" ADD COLUMN "transaction_type_id" uuid;
--> statement-breakpoint
DO $$
DECLARE
  expense_id uuid;
  payment_id uuid;
BEGIN
  SELECT "id" INTO expense_id FROM "transaction_types" WHERE "slug" = 'expense';
  SELECT "id" INTO payment_id FROM "transaction_types" WHERE "slug" = 'payment';

  UPDATE "expenses" SET "transaction_type_id" = expense_id WHERE "transaction_type" = 'expense';
  UPDATE "expenses" SET "transaction_type_id" = payment_id WHERE "transaction_type" = 'payment';

  IF EXISTS (SELECT 1 FROM "expenses" WHERE "transaction_type_id" IS NULL) THEN
    RAISE EXCEPTION 'transaction_type_id backfill left rows unassigned; aborting rather than silently losing a classification';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX "expenses_transaction_type_id_idx" ON "expenses" ("transaction_type_id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'expenses'::regclass
       AND conname = 'expenses_transaction_type_id_fkey'
  ) THEN
    ALTER TABLE "expenses"
      ADD CONSTRAINT "expenses_transaction_type_id_fkey"
      FOREIGN KEY ("transaction_type_id") REFERENCES "transaction_types"("id")
      ON DELETE restrict ON UPDATE cascade;
  END IF;
END $$;