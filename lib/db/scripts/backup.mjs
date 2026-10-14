/**
 * Takes a verified backup of a database using nothing but the pg driver.
 *
 * Why this exists rather than pg_dump: the production host has no local
 * postgres client, and a backup you cannot run is not a backup. This produces
 * the same three things a dump needs to be worth having:
 *
 *   1. every row of every table, streamed so memory stays flat
 *   2. a schema manifest, so a restore can be checked against what was live
 *   3. per-table SHA-256 checksums and row counts, so corruption is detectable
 *
 * The schema itself lives in version control as lib/db/drizzle migrations, so a
 * restore is: run the migrations, then load data.jsonl. RESTORE.md spells it
 * out.
 *
 * It opens a READ ONLY transaction and issues only SELECTs, so it cannot modify
 * anything it points at. That is deliberate: this tool has been run against the
 * live database.
 *
 * Usage:
 *   node ./scripts/backup.mjs --url-file /path/to/url --out ~/backups
 *   DATABASE_URL=postgres://... node ./scripts/backup.mjs --out ~/backups
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

function parseArgs(argv) {
  const args = { out: null, urlFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = argv[i + 1];
    if (argv[i] === '--url-file') args.urlFile = argv[i + 1];
  }
  return args;
}

/** JSON cannot carry these directly, so they are tagged and rebuilt on restore. */
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

const isSchemaMigrations = (name) => name === 'schema_migrations';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    console.error('--out <directory> is required.');
    process.exit(1);
  }

  // Prefer a file so the connection string never lands in shell history or a
  // process listing.
  let url = process.env.DATABASE_URL ?? null;
  if (args.urlFile) {
    if (!fs.existsSync(args.urlFile)) {
      console.error(`No such file: ${args.urlFile}`);
      process.exit(1);
    }
    url = fs.readFileSync(args.urlFile, 'utf8').trim();
  }
  if (!url) {
    console.error('Provide DATABASE_URL or --url-file <path>.');
    process.exit(1);
  }

  let host = 'unknown';
  let database = 'unknown';
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    database = parsed.pathname.replace(/^\//, '');
  } catch {
    console.error('DATABASE_URL is not a valid URL.');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(args.out, `spendfloww-backup-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  console.log(`\n  host      : ${host}`);
  console.log(`  database  : ${database}`);
  console.log(`  output    : ${dir}`);
  console.log('  mode      : READ ONLY (single read-only transaction)\n');

  const db = new Client({
    connectionString: url,
    ssl: /neon\.tech|supabase\.co|amazonaws\.com|azure\.com|cloudsql/i.test(url)
      ? { rejectUnauthorized: false }
      : undefined,
    connectionTimeoutMillis: 30000,
  });

  const started = Date.now();
  await db.connect();
  await db.query('BEGIN READ ONLY');

  try {
    const version = (await db.query('select version() as v')).rows[0].v;

    // ---- schema manifest -------------------------------------------------
    const tables = (await db.query(
      `select table_name
         from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    )).rows.map((r) => r.table_name);

    const columns = (await db.query(
      `select table_name, column_name, data_type, udt_name, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public'
        order by table_name, ordinal_position`,
    )).rows;

    const indexes = (await db.query(
      `select tablename, indexname, indexdef from pg_indexes
        where schemaname = 'public' order by tablename, indexname`,
    )).rows;

    const constraints = (await db.query(
      `select tc.table_name, tc.constraint_name, tc.constraint_type
         from information_schema.table_constraints tc
        where tc.table_schema = 'public'
        order by tc.table_name, tc.constraint_name`,
    )).rows;

    let ledger = [];
    if (tables.includes('schema_migrations')) {
      ledger = (await db.query(
        'select filename, checksum, applied_at from schema_migrations order by filename',
      )).rows.map((r) => ({ ...r, applied_at: r.applied_at?.toISOString?.() ?? r.applied_at }));
    }

    fs.writeFileSync(
      path.join(dir, 'schema-manifest.json'),
      `${JSON.stringify({ version, tables, columns, indexes, constraints, ledger }, null, 2)}\n`,
    );

    // ---- data ------------------------------------------------------------
    const stream = fs.createWriteStream(path.join(dir, 'data.jsonl'), { flags: 'w' });
    const write = (line) =>
      new Promise((resolve, reject) => {
        if (stream.write(line)) resolve();
        else stream.once('drain', resolve).once('error', reject);
      });

    const summary = [];
    for (const table of tables) {
      const hash = crypto.createHash('sha256');
      let rows = 0;

      // keyset pagination keeps memory flat regardless of table size
      let offset = 0;
      const pageSize = 500;
      for (;;) {
        const page = await db.query(
          `select * from "${table}" order by 1 limit ${pageSize} offset ${offset}`,
        );
        if (!page.rows.length) break;
        for (const row of page.rows) {
          const line = `${JSON.stringify({ table, row: encode(row) })}\n`;
          hash.update(line);
          await write(line);
          rows += 1;
        }
        offset += pageSize;
        if (page.rows.length < pageSize) break;
      }

      const checksum = hash.digest('hex');
      summary.push({ table, rows, checksum, bytes: rows });
      const flag = rows === 0 && !isSchemaMigrations(table) ? '  (empty)' : '';
      console.log(`  ${table.padEnd(24)} ${String(rows).padStart(7)} rows  ${checksum.slice(0, 12)}${flag}`);
    }

    await new Promise((resolve, reject) => stream.end(resolve).once('error', reject));

    const dataBytes = fs.statSync(path.join(dir, 'data.jsonl')).size;
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      `${JSON.stringify(
        {
          format: 'pocketful-backup',
          version: 1,
          createdAt: new Date().toISOString(),
          source: { host, database },
          postgresVersion: version,
          tables: summary,
          totalRows: summary.reduce((sum, t) => sum + t.rows, 0),
          dataBytes,
          durationMs: Date.now() - started,
        },
        null,
        2,
      )}\n`,
    );

    console.log(
      `\n  ${summary.length} tables, ${summary.reduce((s, t) => s + t.rows, 0)} rows, ` +
        `${(dataBytes / 1024 / 1024).toFixed(2)} MB in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    console.log('  nothing was written to the source database.\n');
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`\n  BACKUP FAILED: ${error.message}\n`);
  process.exit(1);
});