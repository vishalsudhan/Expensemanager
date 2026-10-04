/**
 * Gate for `drizzle-kit push` and `drizzle-kit push --force`.
 *
 * These two commands reshape a database to match the schema, with no migration
 * file and no record of what changed. That is exactly what the project rule
 * forbids:
 *
 *   Code moves through Git. Schema changes move through migrations.
 *   Data never moves from Development to Production.
 *
 * `push` is also the easiest way to lose real data, because it will happily
 * drop or retype a column that holds it. So this gate refuses, in order:
 *
 *   1. no DATABASE_URL
 *   2. NODE_ENV=production (a deployed or CI context)
 *   3. a hostname that looks like production, unless ALLOW_PROVIDER_HOST=1
 *   4. a provider-hosted host even when allowed, unless CONFIRM_SCHEMA_PUSH=1
 *   5. --force always needs CONFIRM_SCHEMA_PUSH_FORCE=1, on any host
 *
 * To change a database's schema, write a numbered migration in lib/db/drizzle
 * and run `migrate up`. That leaves a record and is reviewable in a pull
 * request; this does not.
 */
import { assertSafeTarget, fail } from './lib/guard.mjs';

const force = process.argv.includes('--force');
const isForce = process.argv.includes('-f') || force;

if (!process.env.DATABASE_URL) {
  fail('DATABASE_URL is not set.');
}

if (process.env.NODE_ENV === 'production') {
  fail(
    'NODE_ENV=production.\n' +
      '    drizzle-kit push reshapes the database with no migration file and no\n' +
      '    record. It must never be pointed at production.\n' +
      '    Write a numbered migration in lib/db/drizzle and run "migrate up".',
  );
}

const allowProviderHost = process.env.ALLOW_PROVIDER_HOST === '1';
const target = assertSafeTarget({ url: process.env.DATABASE_URL, allowProviderHost });

const isProviderHost = /neon\.tech|supabase\.co|amazonaws\.com|azure\.com|cloudsql|render\.com/.test(
  target.host,
);

if (isProviderHost && process.env.CONFIRM_SCHEMA_PUSH !== '1') {
  fail(
    `"${target.host}" is a hosted database.\n` +
      '    Re-run with both ALLOW_PROVIDER_HOST=1 and CONFIRM_SCHEMA_PUSH=1 once\n' +
      '    you have confirmed this is the development branch and not production.',
  );
}

if (isForce && process.env.CONFIRM_SCHEMA_PUSH_FORCE !== '1') {
  fail(
    'push --force can drop columns and rewrite data with no rollback.\n' +
      '    Re-run with CONFIRM_SCHEMA_PUSH_FORCE=1 if you are certain.\n' +
      '    Prefer a numbered migration: it is reviewable and recorded.',
  );
}

console.log(`\n  proceeding with drizzle-kit push${isForce ? ' --force' : ''}`);
if (isProviderHost) {
  console.log('  reminder    : this is a hosted database. Confirm it is development.');
}
console.log('  reminder    : schema changes belong in lib/db/drizzle, not in push.\n');