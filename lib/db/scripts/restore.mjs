/**
 * Restores a backup produced by backup.mjs and verifies it byte for byte.
 *
 * The schema is not restored from the dump, because the schema lives in version
 * control as lib/db/drizzle migrations. Run those first, then this:
 *
 *   1. create an empty database
 *   2. apply migrations 0000..N in order   (pnpm db:migrate:up)
 *   3. node ./scripts/restore.mjs <backup-dir> <DATABASE_URL>
 *
 * Every table is re-checksummed afterwards and compared with the manifest, so a
 * restore that silently drops or mangles a row fails loudly rather than looking
 * fine.
 *
 * Tables are loaded parents-first, because expense_labels references both
 * expenses and labels and would otherwise fail its foreign keys.
 *
 * Usage:
 *   node ./scripts/restore.mjs ~/backups/spendfloww-backup-... postgres://...
 *   node ./scripts/restore.mjs <backup-dir> --url-file /path/to/url
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import pg from 'pg';
const { Client } = pg;

const argv = process.argv.slice(2);
const backupDir = argv[0];
const urlFlag = argv.includes('--url-file') ? argv[argv.indexOf('--url-file') + 1] : null;
const url =
  urlFlag && fs.existsSync(urlFlag)
    ? fs.readFileSync(urlFlag, 'utf8').trim()
    : argv.find((a) => a.startsWith('postgres'));
if (!backupDir || !url) {
  console.error('Usage: node ./scripts/restore.mjs <backup-dir> <DATABASE_URL|--url-file>');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));

/** Mirrors the backup's encoder exactly; anything else cannot reproduce the hashes. */
function encode(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Buffer.isBuffer(value)) return { $bytes: value.toString('base64') };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = encode(inner);
    return out;
  }
  return value;
}

// Rebuild the tagged values JSON cannot hold on its own.
function decode(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(decode);
  if (typeof v === 'object') {
    if ('$date' in v) return new Date(v.$date);
    if ('$bytes' in v) return Buffer.from(v.$bytes, 'base64');
    if ('$bigint' in v) return v.$bigint;
    const out = {};
    for (const [k, inner] of Object.entries(v)) out[k] = decode(inner);
    return out;
  }
  return v;
}

const placeholdersFor = (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',');

const db = new Client({ connectionString: url, ssl: /neon\.tech|supabase\.co|amazonaws\.com/.test(url) ? { rejectUnauthorized: false } : undefined });
await db.connect();

// Insert parents before children. expense_labels points at both expenses and
// labels, so loading it in file order breaks the foreign keys.
const fk = (await db.query(
  `select child.relname as child, parent.relname as parent
     from pg_constraint c
     join pg_class child on child.oid = c.conrelid
     join pg_class parent on parent.oid = c.confrelid
    where c.contype = 'f' and child.relnamespace = 'public'::regnamespace
      and parent.relnamespace = 'public'::regnamespace`,
)).rows;

const order = [];
const seen = new Set();
const visit = (table, stack = new Set()) => {
  if (seen.has(table) || stack.has(table)) return;
  stack.add(table);
  for (const edge of fk.filter((e) => e.child === table)) visit(edge.parent, stack);
  stack.delete(table);
  seen.add(table);
  order.push(table);
};
for (const t of manifest.tables.map((x) => x.table)) visit(t);
console.log('  load order:', order.join(' -> '));

const rowsByTable = new Map(order.map((t) => [t, []]));
for await (const line of createInterface({ input: fs.createReadStream(path.join(backupDir, 'data.jsonl')) })) {
  if (!line.trim()) continue;
  const { table, row } = JSON.parse(line);
  rowsByTable.get(table)?.push(decode(row));
}

await db.query('BEGIN');
for (const table of order) {
  const batch = rowsByTable.get(table) ?? [];
  if (!batch.length) continue;
  const cols = Object.keys(batch[0]);
  const values = [];
  const params = [];
  batch.forEach((row, i) => {
    cols.forEach((c, j) => { values.push(`$${i * cols.length + j + 1}`); params.push(row[c]); });
  });
  const rowPlaceholders = batch
    .map((_, i) => `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`)
    .join(',');
  await db.query(
    `insert into "${table}" (${cols.map((c) => `"${c}"`).join(',')}) values ${rowPlaceholders}`,
    params,
  );
  console.log(`    loaded ${table}: ${batch.length}`);
}
await db.query('COMMIT');

// Re-checksum the restored tables and compare with the manifest.
let allMatch = true;
for (const expected of manifest.tables) {
  const hash = crypto.createHash('sha256');
  let rows = 0;
  const res = await db.query(`select * from "${expected.table}" order by 1`);
  for (const row of res.rows) {
    hash.update(`${JSON.stringify({ table: expected.table, row: encode(row) })}\n`);
    rows += 1;
  }
  const match = rows === expected.rows && hash.digest('hex') === expected.checksum;
  if (!match) allMatch = false;
  console.log(`  ${match ? 'MATCH  ' : 'DIFFER '} ${expected.table.padEnd(22)} ${rows}/${expected.rows} rows`);
}
console.log(allMatch ? '\n  RESTORE VERIFIED: every table matches its checksum\n' : '\n  RESTORE MISMATCH\n');
await db.end();
process.exit(allMatch ? 0 : 1);
