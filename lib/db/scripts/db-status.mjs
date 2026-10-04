/**
 * Read-only report of what a database actually looks like right now.
 *
 * Exists to answer, without writing anything and without hand-writing SQL:
 *
 *   - which migrations does the ledger say are applied, and which are pending
 *   - does the schema look like 0000-0003, or is something missing
 *   - how much real data is in there
 *   - is there a discrepancy between the ledger and the live schema
 *
 * Safe to point at production: it opens a read-only transaction and issues only
 * SELECTs. It cannot migrate, seed or modify anything.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node ./scripts/db-status.mjs
 */
import pg from 'pg';
import { fail } from './lib/guard.mjs';

const { Client } = pg;

/** Objects each migration is expected to have created, for drift detection. */
const EXPECTED = [
  { migration: '0000', object: 'table', name: 'expenses' },
  { migration: '0000', object: 'table', name: 'users' },
  { migration: '0000', object: 'table', name: 'currencies' },
  { migration: '0001', object: 'table', name: 'categories' },
  { migration: '0002', object: 'column', table: 'expenses', name: 'transaction_type' },
  { migration: '0002', object: 'column', table: 'expenses', name: 'location_id' },
  { migration: '0002', object: 'column', table: 'categories', name: 'parent_id' },
  { migration: '0003', object: 'table', name: 'sessions' },
  { migration: '0003', object: 'table', name: 'password_reset_tokens' },
];

const url = process.env.DATABASE_URL;
if (!url) fail('DATABASE_URL is not set.');

const parsed = new URL(url);
console.log(`\n  target host : ${parsed.hostname}`);
console.log(`  target db   : ${parsed.pathname}`);
console.log('  mode        : READ-ONLY (single read-only transaction)');

const db = new Client({
  connectionString: url,
  ssl: /neon\.tech|supabase\.co|amazonaws\.com|azure\.com|cloudsql/i.test(url)
    ? { rejectUnauthorized: false }
    : undefined,
});

const count = async (sql) => Number((await db.query(sql)).rows[0].n);
const exists = async (sql, params) => (await db.query(sql, params)).rows[0].present;

try {
  await db.connect();
  await db.query('BEGIN READ ONLY');

  const hasLedger = await exists(`select to_regclass('public.schema_migrations') is not null as present`);
  console.log(`  ledger      : ${hasLedger ? 'present' : 'ABSENT'}`);

  if (hasLedger) {
    const { rows } = await db.query(
      'select filename, applied_at, applied_by from schema_migrations order by filename',
    );
    console.log(`\n  APPLIED MIGRATIONS (${rows.length})`);
    if (!rows.length) console.log('    (ledger exists but is empty)');
    for (const row of rows) {
      const when = new Date(row.applied_at).toISOString().slice(0, 19).replace('T', ' ');
      console.log(`    ${row.filename.padEnd(34)} ${when}  by ${row.applied_by}`);
    }
  } else {
    console.log('\n  APPLIED MIGRATIONS (unknown)');
    console.log('    No schema_migrations table, so nothing records what has run.');
    console.log('    Verify by hand below, then record with: migrate record <file>');
  }

  const drift = [];
  for (const item of EXPECTED) {
    const present =
      item.object === 'table'
        ? await exists(
            `select to_regclass('public.${item.name}') is not null as present`,
          )
        : await exists(
            `select exists (
               select 1 from information_schema.columns
               where table_name = $1 and column_name = $2
             ) as present`,
            [item.table, item.name],
          );
    if (!present) drift.push(`${item.migration} expected ${item.object} ${item.table ? `${item.table}.` : ''}${item.name}`);
  }

  console.log(`\n  SCHEMA CHECK`);
  if (drift.length === 0) {
    console.log('    every expected object from 0000-0003 is present');
  } else {
    console.log('    missing:');
    for (const item of drift) console.log(`      - ${item}`);
    console.log('    A missing object means a migration did not fully apply.');
  }

  console.log('\n  DATA');
  const rows = {};
  for (const table of ['expenses', 'categories', 'projects', 'labels', 'locations', 'currencies', 'users', 'sessions']) {
    const present = await exists(`select to_regclass('public.${table}') is not null as present`);
    if (!present) {
      console.log(`    ${table.padEnd(14)} (table absent)`);
      continue;
    }
    rows[table] = await count(`select count(*)::int as n from ${table}`);
    console.log(`    ${table.padEnd(14)} ${rows[table]}`);
  }

  if (rows.expenses !== undefined) {
    const payments = await count(
      `select count(*)::int as n from expenses where transaction_type = 'payment'`,
    );
    const total = (await db.query(`select coalesce(sum(amount), 0)::text as s from expenses`)).rows[0].s;
    console.log(`    ${'payments'.padEnd(14)} ${payments}`);
    console.log(`    ${'sum(amount)'.padEnd(14)} ${total}`);
  }
  if (rows.categories !== undefined) {
    const archived = await count(`select count(*)::int as n from categories where status = 'archived'`);
    console.log(`    ${'cat archived'.padEnd(14)} ${archived}`);
  }

  await db.query('COMMIT');
  console.log('\n  nothing was written.\n');
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  fail(`could not read database state:\n    ${error.message}`);
} finally {
  await db.end().catch(() => {});
}