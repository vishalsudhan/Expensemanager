/**
 * DEV/TEST verification for the Spendfloww rebrand.
 *
 * The rule under test is asymmetric, and both halves matter:
 *
 *   1. no user-visible "Pocketful" survives in the shipped app, the PWA
 *      manifest, the reset email or the current-behaviour docs
 *   2. every machine identifier stays exactly as it was, because renaming one
 *      would sign people out, drop their cached offline data, reset their
 *      theme, or make existing backups unreadable
 *
 * This is a static check: it reads the source and the built bundle, so it needs
 * no database and no session.
 *
 * Usage: pnpm verify:branding
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` -> ${detail}`}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
}

console.log('Spendfloww rebrand verification');

section('User-visible branding says Spendfloww');
const indexHtml = read('artifacts/expense-manager/index.html');
check('the browser tab title is Spendfloww', /<title>\s*Spendfloww\s*<\/title>/.test(indexHtml));
check('application-name is Spendfloww', /<meta name="application-name" content="Spendfloww"/.test(indexHtml));
check('apple-mobile-web-app-title is Spendfloww', /<meta name="apple-mobile-web-app-title" content="Spendfloww"/.test(indexHtml));
check('og:site_name is Spendfloww', /<meta property="og:site_name" content="Spendfloww"/.test(indexHtml));
check('og:title is Spendfloww', /<meta property="og:title" content="Spendfloww"/.test(indexHtml));

const manifest = JSON.parse(read('artifacts/expense-manager/public/manifest.webmanifest'));
check('the PWA name is Spendfloww', manifest.name === 'Spendfloww', manifest.name);
check('the PWA short_name is Spendfloww', manifest.short_name === 'Spendfloww', manifest.short_name);

const app = read('artifacts/expense-manager/src/App.tsx');
check('the sidebar wordmark is Spendfloww', /spendfloww<\/span>/i.test(app));
check('the footer says SPENDFLOWW', /SPENDFLOWW/.test(app));
check('the sidebar has no old wordmark', !/>pocketful<\/span>/i.test(app));
check('the footer has no old wordmark', !/POCKETFUL/.test(app));

const login = read('artifacts/expense-manager/src/pages/Login.tsx');
check('the login title is Spendfloww', /Sign in to Spendfloww/.test(login));
check('the setup title is Spendfloww', /Claim this Spendfloww/.test(login));
check('no old name in the login screen', !/Pocketful/.test(login));

const email = read('artifacts/api-server/src/lib/email.ts');
check('the reset email subject is Spendfloww', /Reset your Spendfloww password/.test(email));
check('the reset email body is Spendfloww', /this Spendfloww account/.test(email));
check('no old name in the reset email', !/Pocketful/.test(email));

section('Technical identifiers are untouched');
const session = read('artifacts/api-server/src/lib/session.ts');
check('the session cookie is still pocketful_session', /"pocketful_session"/.test(session));
const theme = read('artifacts/expense-manager/src/lib/theme.ts');
check('the theme key is still pocketful-theme', /'pocketful-theme'/.test(theme));
check('the pre-paint theme script still reads the old key', /pocketful-theme/.test(indexHtml));
const offline = read('artifacts/expense-manager/src/lib/offline-store.ts');
check('the offline database is still pocketful-offline', /'pocketful-offline'/.test(offline));
const backupRoute = read('artifacts/api-server/src/routes/backup.ts');
check('the backup document format is still pocketful-backup', /format:\s*"pocketful-backup"/.test(backupRoute));
const spec = read('lib/api-spec/openapi.yaml');
check('the backup format in the spec is unchanged', /enum:\s*\[pocketful-backup\]/.test(spec));

section('Downloaded file names use the new name');
check('the backup download is spendfloww-backup', /filename="spendfloww-backup-/.test(backupRoute));
for (const kind of ['expenses', 'projects', 'categories', 'labels']) {
  check(`the ${kind} CSV is spendfloww-${kind}`, new RegExp(`spendfloww-${kind}-`).test(backupRoute));
}

section('Current-behaviour docs are updated');
const replit = read('replit.md');
check('the docs describe the rebrand', /Spendfloww rebrand/.test(replit));
check('the docs no longer claim the app is called Pocketful', !/this Pocketful account/.test(replit));

section('No stray user-visible references');
// Token-based rather than file-based, because a file can legitimately hold
// both: index.html carries the new title and the old theme key in one place.
// The known identifiers are removed first, and whatever "Pocketful" survives is
// a real miss.
const IDENTIFIERS = /pocketful[_-](session|offline|theme|backup|expenses|projects|categories|labels|pre-\d{4})/gi;
const offenders = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'generated'].includes(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|html|json|yaml|yml|mjs|js|webmanifest)$/.test(entry.name)) continue;
    // This suite names the old string on purpose; excluding it keeps the
    // check honest instead of special-casing it away silently.
    if (rel === 'scripts/verify/verify-branding.mjs') continue;
    const stripped = fs.readFileSync(full, 'utf8').replace(IDENTIFIERS, '');
    const hits = stripped.match(/pocketful/gi);
    if (!hits) continue;
    offenders.push(`${rel} (${hits.length})`);
  }
};
walk(path.join(root, 'artifacts'));
walk(path.join(root, 'lib'));
walk(path.join(root, 'scripts'));
check('no unexpected file mentions the old name', offenders.length === 0, offenders.join(', '));

section('The built bundle carries the new name');
const distIndex = path.join(root, 'artifacts/expense-manager/dist/public');
if (exists('artifacts/expense-manager/dist/public/index.html')) {
  const built = fs.readFileSync(path.join(distIndex, 'index.html'), 'utf8');
  check('the built index.html says Spendfloww', /Spendfloww/.test(built));
  check('the built index.html has no Pocketful', !/Pocketful/.test(built));
} else {
  console.log('  SKIP  no build found (run the frontend build first)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);