-- Partial settlement tracking.
--
-- The question "will this come back to me?" is answered entirely by
-- paid_by = 'me' together with a counterparty, so it needs no column of its
-- own: storing it separately would only create a second source of truth that
-- could disagree with those two.
--
-- tracked_amount is the amount actually being tracked, which need not be the
-- whole expense: a 1000 dinner where a counterparty owes 600 tracks 600.
-- Null means "not tracked", which is exactly the case where no counterparty is
-- named, so the two can never drift apart.
--
-- Amount is a date column and typed below as numeric(14,2) to match expenses.amount.
ALTER TABLE "expenses" ADD COLUMN "tracked_amount" numeric(14, 2);
--> statement-breakpoint
-- Rows tracked before this column existed tracked their full expense amount.
UPDATE "expenses" SET "tracked_amount" = "amount" WHERE "counterparty" IS NOT NULL;
--> statement-breakpoint
-- A named counterparty means something is tracked, and something tracked means
-- an amount.
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_tracked_amount_needs_counterparty_check"
  CHECK ("counterparty" IS NULL OR "tracked_amount" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_tracked_amount_positive_check"
  CHECK ("tracked_amount" IS NULL OR "tracked_amount" > 0);
--> statement-breakpoint
-- The money reports always filter on a named counterparty and sum this column.
CREATE INDEX "expenses_settlement_amount_idx" ON "expenses" ("tracked_amount")
  WHERE "counterparty" IS NOT NULL;