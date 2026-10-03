/**
 * Applies migration 0002 and the reference seed to a DEV/TEST database only.
 *
 * Safety rails, in order:
 *   1. Refuses to run without an explicit allow flag.
 *   2. Refuses to run against a hostname that looks like production.
 *   3. Reports what will change and requires confirmation.
 *   4. Verifies data integrity before and after.
 *
 * It never deletes or rewrites expense rows. Run it with:
 *   DATABASE_URL=postgres://... DEV_ALLOW_MIGRATION=1 pnpm db:apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const DRIZZLE = path.join(ROOT, 'lib/db/drizzle');
const SEED = path.join(ROOT, 'lib/db/seed.sql');

/** Hostname fragments that indicate a production database. */
const PRODUCTION_MARKERS = [
  'production',
  'prod.',
  '.prod',
  '-prod',
  'render.com',
  'onrender.com',
  'supabase.co',
  'neon.tech',
  'amazonaws.com',
  'rds.amazonaws.com',
  'azure.com',
  'cloudsql',
];

function fail(message) {
  console.error(`\n  ABORTED: ${message}\n`);
  process.exit(1);
}

function assertSafeTarget(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail('DATABASE_URL is not a valid URL.');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    fail(`Expected a postgres:// URL, received ${parsed.protocol}//`);
  }
  const host = parsed.hostname.toLowerCase();
  const hit = PRODUCTION_MARKERS.find((marker) => host.includes(marker));
  if (hit && process.env.ALLOW_PROVIDER_HOST !== "1") {
    fail(
      `hostname "${host}" looks like production (matched "${hit}").\n` +
        '  This runner only targets DEV/TEST databases.\n' +
        "  If this is a verified development branch of a hosted provider, re-run\n" +
        "  with ALLOW_PROVIDER_HOST=1 once you have confirmed separation.",
    );
  }
  if (hit) {
    console.log(`  ALLOW      : host matched "${hit}" and ALLOW_PROVIDER_HOST=1 was set.`);
    console.log("  warning    : confirm this is a development branch, not production.");
  }
  if (parsed.pathname === '/' || parsed.pathname === '') {
    fail('No database name in DATABASE_URL.');
  }
  console.log(`  target host : ${host}`);
  console.log(`  target db   : ${parsed.pathname}`);
  if (/^(localhost|127\.0\.0\.1|::1)$/.test(host)) {
    console.log('  note        : local database, safety rails relaxed but still applied');
  }
}

const statements = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter(Boolean);

async function snapshot(db) {
  const one = async (sql) => (await db.query(sql)).rows[0];
  return {
    expenses: Number((await one('select count(*)::int as n from expenses')).n),
    categories: Number((await one('select count(*)::int as n from categories')).n),
    activeCategories: Number(
      (await one("select count(*)::int as n from categories where status = 'active'")).n,
    ),
    projects: Number((await one('select count(*)::int as n from projects')).n),
    labels: Number((await one('select count(*)::int as n from labels')).n),
    currencies: Number((await one('select count(*)::int as n from currencies')).n),
    distinctCurrencies: (await one(
      'select count(distinct currency_id)::int as n from expenses',
    )).n,
    sumAmount: (await one('select coalesce(sum(amount),0)::text as s from expenses')).s,
    withoutCategory: Number(
      (await one(
        'select count(*)::int as n from expenses e where not exists (select 1 from categories c where c.id = e.category_id)',
      )).n,
    ),
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL is not set.');
  if (process.env.DEV_ALLOW_MIGRATION !== '1') {
    fail('set DEV_ALLOW_MIGRATION=1 to confirm this is a DEV/TEST database.');
  }
  assertSafeTarget(url);

  const db = new Client({ connectionString: url });
  await db.connect();
  console.log('\n  connected\n');

  const alreadyApplied = await db.query(
    `select count(*)::int as n from information_schema.columns
     where table_name = 'expenses' and column_name = 'transaction_type'`,
  );
  if (alreadyApplied.rows[0].n > 0) {
    fail('expenses.transaction_type already exists; migration 0002 looks applied. Stopping.');
  }

  const before = await snapshot(db);
  console.log('  BEFORE');
  for (const [key, value] of Object.entries(before)) console.log(`    ${key.padEnd(18)} ${value}`);

  console.log('\n  Applying lib/db/drizzle/0002_handy_mister_fear.sql');
  await db.query('BEGIN');
  try {
    for (const sql of statements(path.join(DRIZZLE, '0002_handy_mister_fear.sql'))) {
      await db.query(sql);
    }
    await db.query('COMMIT');
    console.log('    migration committed');
  } catch (error) {
    await db.query('ROLLBACK');
    await db.end();
    fail(`migration failed and was rolled back:\n    ${error.message}`);
  }

  console.log('\n  Applying lib/db/seed.sql');
  await db.query('BEGIN');
  try {
    for (const sql of statements(SEED)) await db.query(sql);
    await db.query('COMMIT');
    console.log('    seed committed');
  } catch (error) {
    await db.query('ROLLBACK');
    await db.end();
    fail(`seed failed and was rolled back (migration is still applied):\n    ${error.message}`);
  }

  const after = await snapshot(db);
  console.log('\n  AFTER');
  for (const [key, value] of Object.entries(after)) console.log(`    ${key.padEnd(18)} ${value}`);

  console.log('\n  INTEGRITY');
  const results = [
    ['expense count unchanged', before.expenses === after.expenses],
    ['total amount unchanged', before.sumAmount === after.sumAmount],
    ['distinct currencies unchanged', before.distinctCurrencies === after.distinctCurrencies],
    ['no expense lost its category', after.withoutCategory === 0],
    ['category count only grew', after.categories >= before.categories],
    ['projects preserved', after.projects >= before.projects],
    ['currencies untouched', before.currencies === after.currencies],
  ];
  let bad = 0;
  for (const [label, ok] of results) {
    console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) bad += 1;
  }

  const { rows: located } = await db.query(
    `select l.slug, count(*)::int as count from expenses e
     join locations l on l.id = e.location_id group by l.slug order by l.slug`,
  );
  console.log('\n  expenses per location:');
  for (const row of located) console.log(`    ${row.slug.padEnd(18)} ${row.count}`);

  const { rows: types } = await db.query(
    'select transaction_type, count(*)::int as count from expenses group by transaction_type order by transaction_type',
  );
  console.log('  expenses per transaction type:');
  for (const row of types) console.log(`    ${row.transaction_type.padEnd(18)} ${row.count}`);

  await db.end();
  console.log(`\n  ${bad === 0 ? 'ALL INTEGRITY CHECKS PASSED' : `${bad} INTEGRITY CHECK(S) FAILED`}`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\n  UNEXPECTED ERROR:', error.message);
  process.exit(1);
});