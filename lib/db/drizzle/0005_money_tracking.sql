CREATE TYPE "paid_by" AS ENUM('me', 'someone_else');
--> statement-breakpoint
CREATE TYPE "settlement_status" AS ENUM('pending', 'settled');
--> statement-breakpoint
-- Money tracking, kept on the expense row itself so a settlement is an update to
-- the original expense and can never create a second one.
--
-- `paid_by` is who put the money up. `counterparty` is the person or organisation
-- on the other side, free text, and is the opt-in: with no counterparty the row
-- is an ordinary expense and these columns are simply unused. `settlement_status`
-- is deliberately one column rather than "received" and "paid back" separately,
-- because those are the same fact seen from either side; the label is chosen from
-- `paid_by` when it is shown.
--
-- Existing rows land on paid_by = 'me' with no counterparty and no status, which
-- is exactly "an ordinary expense I paid for, nothing to track".
ALTER TABLE "expenses" ADD COLUMN "paid_by" "paid_by" NOT NULL DEFAULT 'me';
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "counterparty" text;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "settlement_status" "settlement_status";
--> statement-breakpoint
-- A settlement is only meaningful once there is somebody to settle it with.
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_settlement_needs_counterparty_check"
  CHECK ("settlement_status" IS NULL OR "counterparty" IS NOT NULL);
--> statement-breakpoint
-- Supports the money reports, which always filter on the counterparty being set.
CREATE INDEX "expenses_counterparty_idx" ON "expenses" ("counterparty");
--> statement-breakpoint
CREATE INDEX "expenses_money_tracking_idx" ON "expenses" ("paid_by", "settlement_status")
  WHERE "counterparty" IS NOT NULL;