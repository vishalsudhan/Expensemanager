/**
 * Applies pending SQL migrations from lib/db/drizzle in order, exactly once each,
 * recording what it applied in a schema_migrations ledger.
 *
 * Why a ledger rather than drizzle-kit migrate:
 *   Production was originally created by hand rather than by `drizzle-kit
 *   migrate`, so its __drizzle_migrations table is absent or incomplete. Without
 *   a trustworthy record, "which migrations has production actually run?" can
 *   only be answered by hand, and `drizzle-kit migrate` would try to re-run
 *   0000 against tables that already exist. schema_migrations is ours, and it
 *   is created on demand.
 *
 * Two guarantees this provides:
 *   1. Idempotent. A migration recorded as applied is never re-applied.
 *   2. Detects edits to history. If a file that was already applied has been
 *      modified on disk, the run aborts instead of silently diverging. Applied
 *      migrations are immutable; corrections go in a new numbered file.
 *
 * Commands:
 *   node ./scripts/migrate.mjs status              read-only, report applied/pending
 *   node ./scripts/migrate.mjs up                  apply everything pending
 *   node ./scripts/migrate.mjs up --allow-host     apply, permitting a hosted dev branch
 *   node ./scripts/migrate.mjs record <file>       mark an already-applied file as applied
 *
 * Never copies data between databases. A migration changes schema only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertSafeTarget, fail } from './lib/guard.mjs';

const { Client } = pg;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const DRIZZLE = path.join(ROOT, 'lib/db/drizzle');

const LEDGER = `create table if not exists schema_migrations (
  filename text primary key,
  checksum text not null,
  applied_at timestamptz not null default now(),
  applied_by text not null default current_user
)`;

/** Migrations in the order drizzle's journal defines them, journal first if readable. */
function migrationFiles() {
  const journalPath = path.join(DRIZZLE, 'meta/_journal.json');
  const onDisk = fs
    .readdirSync(DRIZZLE)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (!fs.existsSync(journalPath)) return onDisk;

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const ordered = journal.entries
    .map((entry) => `${entry.tag}.sql`)
    .filter((name) => onDisk.includes(name));
  // Anything not yet in the journal is still pending work; keep it after the
  // recorded ones so ordering stays deterministic.
  return [...ordered, ...onDisk.filter((name) => !ordered.includes(name))];
}

const checksumOf = (contents) =>
  crypto.createHash('sha256').update(contents, 'utf8').digest('hex');

function readMigration(name) {
  const file = path.join(DRIZZLE, name);
  const contents = fs.readFileSync(file, 'utf8');
  const statements = contents
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter(Boolean);
  return { name, checksum: checksumOf(contents), statements };
}

async function ensureLedger(db) {
  await db.query(LEDGER);
}

async function readLedger(db) {
  const { rows } = await db.query('select filename, checksum, applied_at from schema_migrations');
  return new Map(rows.map((row) => [row.filename, row]));
}

/**
 * Fails when a migration that was already applied has been edited on disk.
 * Renaming a file is also caught, because the old name stays in the ledger and
 * the new one shows up as pending.
 */
function assertNoHistoryDrift(files, ledger) {
  const problems = [];
  for (const file of files) {
    const recorded = ledger.get(file.name);
    if (recorded && recorded.checksum !== file.checksum) {
      problems.push(
        `  ${file.name} was already applied but has been modified.\n` +
          '    Applied migrations are immutable. Put the correction in a new\n' +
          '    numbered migration instead of editing this one.',
      );
    }
  }
  for (const recordedName of ledger.keys()) {
    if (!files.some((file) => file.name === recordedName)) {
      problems.push(
        `  ${recordedName} is recorded as applied but is missing from lib/db/drizzle.\n` +
          '    Restore the file, or drop the ledger row if it was recorded in error.',
      );
    }
  }
  if (problems.length) {
    console.error('\n  ABORTED: migration history does not match the ledger.\n');
    for (const problem of problems) console.error(`${problem}\n`);
    process.exit(1);
  }
}

function plan(files, ledger) {
  return files.map((file) => ({
    ...file,
    state: ledger.has(file.name) ? 'applied' : 'pending',
  }));
}

function printPlan(rows, { readOnly }) {
  const pad = (value) => String(value).padEnd(34);
  console.log(`\n  ${pad('migration')}  ${readOnly ? 'state' : 'action'}`);
  console.log(`  ${'-'.repeat(34)}  ${'-'.repeat(8)}`);
  for (const row of rows) {
    const verb = readOnly ? row.state : row.state === 'pending' ? 'apply' : 'skip (done)';
    console.log(`  ${pad(row.name)}  ${verb}`);
  }
  const pending = rows.filter((row) => row.state === 'pending').length;
  console.log(
    `\n  ${rows.length} migration(s), ${rows.length - pending} applied, ${pending} pending\n`,
  );
  return pending;
}

async function main() {
  const [command = 'status', ...rest] = process.argv.slice(2);
  const allowProviderHost = rest.includes('--allow-host') || process.env.ALLOW_PROVIDER_HOST === '1';
  const url = process.env.DATABASE_URL;

  // status is read-only, so it may look at production. Everything else mutates.
  const readOnly = command === 'status';
  const target = readOnly
    ? (() => {
        if (!url) fail('DATABASE_URL is not set.');
        const parsed = new URL(url);
        console.log(`  target host : ${parsed.hostname}`);
        console.log(`  target db   : ${parsed.pathname}`);
        console.log('  mode        : READ-ONLY (no writes)');
        return { host: parsed.hostname };
      })()
    : assertSafeTarget({ url, allowProviderHost });

  const files = migrationFiles().map(readMigration);

  const db = new Client({ connectionString: url, ssl: needsSsl(url) });
  await db.connect();
  try {
    if (!readOnly) {
      await ensureLedger(db);
      console.log('\n  ledger      : schema_migrations ready');
    }
    const ledger = await (async () => {
      const exists = await db.query(
        `select to_regclass('public.schema_migrations') is not null as present`,
      );
      if (!exists.rows[0].present) return new Map();
      return readLedger(db);
    })();

    if (command === 'status') {
      const pending = printPlan(plan(files, ledger), { readOnly: true });
      console.log(`  host        : ${target.host}`);
      if (pending > 0) {
        console.log(
          `\n  ${pending} migration(s) would be applied by "migrate up". This command changed nothing.\n`,
        );
      }
      return;
    }

    if (command === 'record') {
      const target_ = rest.find((arg) => !arg.startsWith('--'));
      if (!target_) fail('record needs the migration filename, e.g. record 0003_user_auth.sql');
      if (!files.some((file) => file.name === target_)) {
        fail(`${target_} is not present in lib/db/drizzle.`);
      }
      if (ledger.has(target_)) {
        console.log(`\n  ${target_} is already recorded as applied. Nothing to do.\n`);
        return;
      }
      const file = files.find((f) => f.name === target_);
      await db.query(
        `insert into schema_migrations (filename, checksum) values ($1, $2)
         on conflict (filename) do nothing`,
        [file.name, file.checksum],
      );
      console.log(
        `\n  recorded ${target_} as already applied.\n` +
          '  This asserts you verified the schema by hand first; nothing was executed.\n',
      );
      return;
    }

    if (command !== 'up') {
      fail(`unknown command "${command}". Use status, up, or record <file>.`);
    }

    assertNoHistoryDrift(files, ledger);
    const pending = printPlan(plan(files, ledger), { readOnly: false });
    if (pending === 0) {
      console.log('  nothing to do.\n');
      return;
    }

    for (const file of files) {
      if (ledger.has(file.name)) continue;
      console.log(`\n  applying ${file.name} (${file.statements.length} statements)`);
      await db.query('BEGIN');
      try {
        for (const sql of file.statements) await db.query(sql);
        await db.query(
          `insert into schema_migrations (filename, checksum) values ($1, $2)`,
          [file.name, file.checksum],
        );
        await db.query('COMMIT');
        console.log('    committed and recorded');
      } catch (error) {
        await db.query('ROLLBACK');
        fail(`failed on ${file.name}, rolled back:\n    ${error.message}`);
      }
    }
    console.log('\n  all pending migrations applied.\n');
  } finally {
    await db.end().catch(() => {});
  }
}

function needsSsl(url) {
  return /neon\.tech|supabase\.co|amazonaws\.com|azure\.com|cloudsql/i.test(url)
    ? { rejectUnauthorized: false }
    : undefined;
}

main().catch((error) => {
  console.error(`\n  ERROR: ${error.message}\n`);
  process.exit(1);
});