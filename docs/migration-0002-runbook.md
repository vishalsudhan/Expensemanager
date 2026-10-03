# Migration 0002 runbook — location, category hierarchy, transaction type

**Status:** validated offline only. Not applied to DEV/TEST or production.
**Applies to:** `lib/db/drizzle/0002_handy_mister_fear.sql` + `lib/db/seed.sql`

---

## What this migration does

Adds three independent classification dimensions to expenses:

| Change | Type | Notes |
| --- | --- | --- |
| `locations` table | new table | Seeded with India (`IN`) and Qatar (`QA). Country code is metadata only; **no currency is implied**. |
| `expenses.location_id` | new column, `NOT NULL` | Existing rows backfilled to India. |
| `expenses.transaction_type` | new column, `NOT NULL` | Enum `expense \| payment`, default `expense`. |
| `categories.parent_id` | new column, nullable | Self-referencing FK. Enforced to exactly one level by trigger. |
| `categories.slug` | new column, `NOT NULL` | Backfilled from existing names with a dedupe suffix. |
| `transaction_type` enum | new type | |

### What it deliberately does not do

- No table, column or type is dropped or altered.
- No expense `amount`, `date`, `category_id`, `currency_id` or `project_id` is rewritten.
- No expense is deleted, and no `category_id` is remapped.
- No category is deleted. Legacy flat categories are **archived**, and colliding names get a ` (legacy)` marker so the new hierarchy can use the clean name. **IDs stay the same**, so existing expenses keep pointing at the same category.

---

## 1. Offline validation already completed

`0000` + `0001` were replayed into a scratch Postgres, seeded with 15 legacy flat
categories / 3 legacy projects / 5 labels and 8 legacy expenses across INR and
QAR, then `0002` and `seed.sql` were applied for real.

- 30 migration/seed assertions passed.
- 19 edge-case assertions passed (empty database, slug collisions, `NOT NULL`
  enforcement, hierarchy depth, reference-data preservation).
- `seed.sql` is idempotent: re-running it is a no-op.

This caught one real defect, now fixed: the slug-backfill CTE ordered by
`created_at`, which was not projected into the CTE, so the migration aborted on
statement 7 of 19.

---

## 2. Backup before anything else

```bash
# From a machine that can reach the database.
pg_dump "$DATABASE_URL" --format=custom --file="pocketful-pre-0002-$(date +%Y%m%d-%H%M%S).dump"
ls -lh pocketful-pre-0002-*.dump
```

Keep the dump until the change has been observed in production for a day.

Optional, to record a rollback baseline:

```bash
psql "$DATABASE_URL" -c "select count(*) as expenses, coalesce(sum(amount),0) as total, \
  count(distinct currency_id) as currencies from expenses;" \
  -c "select id, name, slug, status from categories order by name;" \
  -c "select id, name, status from projects order by name;"
```

---

## 3. Confirm the migration has not already run

```bash
psql "$DATABASE_URL" -tAc "select count(*) from information_schema.columns \
  where table_name='expenses' and column_name='transaction_type';"
```

Expected: `0`. If it returns `1`, stop — migration 0002 is already applied.

---

## 4. Apply it

Use the guarded runner. It refuses production-looking hostnames, refuses to run
without `DEV_ALLOW_MIGRATION=1`, refuses to re-apply, runs each file inside a
transaction, and compares data snapshots before and after.

```bash
DATABASE_URL="postgres://..." DEV_ALLOW_MIGRATION=1 \
  pnpm --filter @workspace/db run apply:migration
```

To target production deliberately you must rename the database host so it is not
recognised as production, or bypass the guard — **only after explicit written
approval**. Prefer running the two files by hand inside a transaction instead:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f lib/db/drizzle/0002_handy_mister_fear.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f lib/db/seed.sql
```

Both files are already split on `--> statement-breakpoint`, which `psql` treats as
an ordinary comment, so `-f` runs them as-is.

### Drizzle tracking caveat

`pnpm migrate` (drizzle-kit) applies migrations listed in
`lib/db/drizzle/meta/_journal.json` that are absent from the `__drizzle_migrations`
table. If production was originally created by `drizzle-kit push` rather than
`migrate`, that table may be empty and drizzle-kit would try to re-run `0000`,
which will fail because the tables already exist. Prefer the explicit
`psql -f` form above, or first confirm `0000` and `0001` are recorded in
`__drizzle_migrations`.

---

## 5. Verify

```bash
psql "$DATABASE_URL" -c "
  select count(*) as expenses, coalesce(sum(amount),0) as total,
         count(*) filter (where transaction_type <> 'expense') as non_expense
  from expenses;"

psql "$DATABASE_URL" -c "
  select count(*) as dangling
  from expenses e where not exists (select 1 from categories c where c.id = e.category_id);"

psql "$DATABASE_URL" -c "
  select l.slug, e.transaction_type, count(*)
  from expenses e join locations l on l.id = e.location_id
  group by 1,2 order by 1,2;"

psql "$DATABASE_URL" -c "
  select count(*) filter (where parent_id is null) as parents,
         count(*) filter (where parent_id is not null) as children
  from categories;"
```

Expected:

- `expenses` count and `total` identical to the pre-migration snapshot.
- `dangling` = `0`.
- `non_expense` = `0` immediately after migrating (it only rises once a bill
  payment is recorded).
- Every legacy expense under `india`.
- `parents` = 11, `children` = 50 (plus the archived legacy rows).

Then run the full suite against DEV/TEST, not production:

```bash
DATABASE_URL="postgres://..." API_URL="https://<dev-host>" pnpm verify:stage17
```

---

## 6. Rollback

`0002` is additive, so the schema rollback below drops what it added.
Pre-existing rows keep their values, because nothing existing was rewritten.

```sql
BEGIN;
DROP TRIGGER IF EXISTS categories_single_level_hierarchy ON categories;
DROP FUNCTION IF EXISTS categories_enforce_single_level_hierarchy();

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_location_id_locations_id_fk;
DROP INDEX IF EXISTS expenses_transaction_type_idx;
DROP INDEX IF EXISTS expenses_location_id_idx;
ALTER TABLE expenses DROP COLUMN IF EXISTS transaction_type;
ALTER TABLE expenses DROP COLUMN IF EXISTS location_id;
DROP TYPE IF EXISTS transaction_type;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_parent_id_categories_id_fk;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_parent_not_self_check;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_slug_unique;
DROP INDEX IF EXISTS categories_parent_id_idx;
ALTER TABLE categories DROP COLUMN IF EXISTS parent_id;
ALTER TABLE categories DROP COLUMN IF EXISTS slug;

DROP TABLE IF EXISTS locations;
COMMIT;
```

### Important: that block is schema-only

It does **not** undo `seed.sql`. After it runs you still have all 61 seeded
hierarchy categories, and the renamed legacy rows are still archived and still
suffixed ` (legacy)`. This was verified: rolling back the schema leaves 61
categories where there was 1, and the original category still archived.

The old app keeps working in that state, but the category list is wrong. To
restore the exact pre-migration state, **restore the section 2 dump instead.**

If a dump is not acceptable, this second block removes exactly what the seed
added and restores the legacy rows, using the stable id prefixes the seed uses:

```sql
BEGIN;
-- Remove only rows the seed created (stable prefixes 20000000-/30000000-).
DELETE FROM categories WHERE id::text LIKE '20000000-%' OR id::text LIKE '30000000-%';

-- Undo the legacy rename and un-archive the pre-existing categories.
UPDATE categories
SET name = left(name, length(name) - length(' (legacy)')),
    status = 'active'
WHERE name LIKE '% (legacy)'
  AND id::text NOT LIKE '20000000-%'
  AND id::text NOT LIKE '30000000-%';

-- Remove the four projects the seed added.
DELETE FROM projects WHERE id::text LIKE '40000000-%';
COMMIT;
```

Verify afterwards that `parents` and `children` are both `0` and that no category
name ends in `(legacy)`.

---

## 7. Risks and manual actions

| Risk | Severity | Mitigation |
| --- | --- | --- |
| `categories.name` is globally unique, so new hierarchy names collide with archived legacy names | Handled | Legacy rows are renamed with a ` (legacy)` marker; IDs unchanged |
| New code rejects expenses filed under a grouping parent | Behaviour change | Intentional: `category_id` must be the leaf. Existing rows are unaffected because they were valid before the hierarchy existed |
| Legacy expenses are all attributed to India | Data judgement | Reversible per row; no currency is changed |
| Vercel deploys before the migration runs | **High if out of order** | Deploy the API only after the migration succeeds; the old frontend ignores the new columns |
| `drizzle-kit migrate` re-running `0000` | Medium | Use `psql -f`, or check `__drizzle_migrations` first |
| Trigger blocks a future deeper nesting | Low | Intended; the hierarchy is specified as one level |
| Manual action | — | None required beyond running the two files |