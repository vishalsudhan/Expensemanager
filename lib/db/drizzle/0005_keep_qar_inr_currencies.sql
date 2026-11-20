-- 0005_keep_qar_inr_currencies: offer only QAR and INR when picking a currency.
-- DATA-ONLY AND NON-DESTRUCTIVE. Nothing is deleted and no amount changes:
-- AED, USD, EUR and GBP are switched off (is_active = false), not removed.
-- Expenses and projects that already use one of them keep it and still show
-- it; it just can't be chosen for anything new. Any currency can be switched
-- back on in Settings -> Currencies. Safe to apply before or after the deploy.
UPDATE "currencies" SET "is_active" = ("code" IN ('QAR', 'INR'));
