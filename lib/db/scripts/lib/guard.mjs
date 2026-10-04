/**
 * Shared safety rails for any script that can change a database.
 *
 * The rule this exists to enforce:
 *
 *   Code moves through Git. Schema changes move through migrations.
 *   Data never moves from Development to Production.
 *
 * So a script that mutates a schema must refuse a production-looking host
 * unless the operator deliberately overrides it, and must say which host it is
 * about to touch before it does anything.
 */

/**
 * Hostname fragments that indicate a real or managed production database.
 *
 * `neon.tech` and the other provider domains cover both production and hosted
 * development branches, so hitting one of these needs ALLOW_PROVIDER_HOST=1 to
 * proceed. That friction is deliberate: a development branch is allowed, but
 * only by someone who has confirmed the separation.
 */
export const PRODUCTION_MARKERS = [
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

export function fail(message) {
  console.error(`\n  ABORTED: ${message}\n`);
  process.exit(1);
}

export function looksLikeProduction(hostname) {
  const host = hostname.toLowerCase();
  return PRODUCTION_MARKERS.find((marker) => host.includes(marker));
}

/**
 * Validates DATABASE_URL and reports the target.
 *
 * `allowProviderHost` controls what happens when the host matches a provider
 * marker. Pass '1' for scripts that may legitimately run against a hosted
 * development branch; leave it unset to make production unreachable.
 */
export function assertSafeTarget({
  url,
  allowProviderHost = false,
  requireDatabase = true,
} = {}) {
  if (!url) fail('DATABASE_URL is not set.');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail('DATABASE_URL is not a valid URL.');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    fail(`Expected a postgres:// URL, received ${parsed.protocol}//`);
  }
  if (requireDatabase && (parsed.pathname === '/' || parsed.pathname === '')) {
    fail('No database name in DATABASE_URL.');
  }

  const host = parsed.hostname.toLowerCase();
  const hit = looksLikeProduction(host);

  if (hit && !allowProviderHost) {
    fail(
      `hostname "${host}" looks like production (matched "${hit}").\n` +
        '    Refusing to continue.\n' +
        '    If this is a verified development branch of a hosted provider, re-run\n' +
        '    with ALLOW_PROVIDER_HOST=1 once you have confirmed the separation.',
    );
  }
  if (hit) {
    console.log(`  ALLOW      : host matched "${hit}" and ALLOW_PROVIDER_HOST=1 was set.`);
    console.log('  warning    : confirm this is a development branch, not production.');
  }

  console.log(`  target host : ${host}`);
  console.log(`  target db   : ${parsed.pathname}`);
  if (/^(localhost|127\.0\.0\.1|::1)$/.test(host)) {
    console.log('  note        : local database, safety rails relaxed but still applied');
  }
  return { host, database: parsed.pathname, isLocal: /^(localhost|127\.0\.0\.1|::1)$/.test(host) };
}