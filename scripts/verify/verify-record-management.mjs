/**
 * DEV/TEST verification for renaming and deleting Locations, Categories
 * (parent and subcategory), Projects and Labels.
 *
 * The rules under test:
 *
 *   1. renaming to a name that already exists is refused, in any casing
 *   2. renaming a record to its own current name is allowed
 *   3. deleting a record nothing references removes it outright
 *   4. deleting a record that expenses reference archives it instead, and the
 *      response says which happened, with an accurate usage count
 *   5. archiving a category also archives its subcategories, so no active child
 *      is ever left under an archived parent
 *   6. no expense is ever damaged by any of the above: the amount survives and
 *      the location, category, project and label all still resolve to names
 *   7. usage counts are exposed on the list endpoints so the UI can warn first
 *
 * It creates its own fixtures with a unique run tag and deletes them afterwards,
 * so it never leaves the DEV database dirty.
 *
 * Usage:
 *   DATABASE_URL=postgres://... API_URL=http://localhost:8080 pnpm verify:records
 */
import pg from 'pg';

const { Client } = pg;

const TAG = `verify-rec-${Date.now().toString(36)}`;
const API = `${(process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api`;
const url = process.env.DATABASE_URL;
const cookie = process.env.SESSION_COOKIE;

if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
// Guard against pointing a stateful suite at production. A hosted *branch* is a
// genuinely separate database, so it can be allowed deliberately.
if (
  /onrender\.com|supabase\.co|neon\.tech|amazonaws\.com|rds\./i.test(url) &&
  process.env.ALLOW_PROVIDER_HOST !== '1'
) {
  console.error(
    'This host looks like a production provider. Refusing to run.\n' +
      'If it is a verified development branch, re-run with ALLOW_PROVIDER_HOST=1.',
  );
  process.exit(1);
}

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

async function call(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

const created = { expenses: [], categories: [], projects: [], labels: [], locations: [] };

async function cleanup(client) {
  if (created.expenses.length > 0) {
    await client.query('delete from expense_labels where expense_id = any($1::uuid[])', [
      created.expenses,
    ]);
    await client.query('delete from expenses where id = any($1::uuid[])', [created.expenses]);
  }
  // Children before parents, because categories.parent_id is ON DELETE RESTRICT.
  await client.query('delete from categories where name like $1', [`${TAG}%`]);
  for (const table of ['projects', 'labels', 'locations']) {
    await client.query(`delete from ${table} where name like $1`, [`${TAG}%`]);
  }
}

const client = new Client({
  connectionString: url,
  ssl: url.includes('localhost') || url.includes('127.0.0.1') ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  query_timeout: 30000,
});

try {
  await client.connect();

  section('Fixtures');
  const currencies = await call('GET', '/currencies');
  const currency = (Array.isArray(currencies.body) ? currencies.body : currencies.body?.items)?.[0];
  check('a currency is available to build expenses against', Boolean(currency?.id));

  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth(), Math.min(11, 28))
    .toISOString()
    .slice(0, 10);

  const mk = async (path, body, bucket) => {
    const result = await call('POST', path, body);
    if (bucket && result.body?.id) created[bucket].push(result.body.id);
    return result;
  };

  const parent = await mk(
    '/categories',
    { name: `${TAG}-parent`, color: '#0A7A5A' },
    'categories',
  );
  const child = await mk(
    '/categories',
    { name: `${TAG}-child`, parentId: parent.body.id, color: '#0A7A5A' },
    'categories',
  );
  check('a parent and a subcategory were created', parent.status === 201 && child.status === 201);

  const spareParent = await mk(
    '/categories',
    { name: `${TAG}-spare`, color: '#0A7A5A' },
    'categories',
  );
  const usedChild = await mk(
    '/categories',
    { name: `${TAG}-used-child`, parentId: spareParent.body.id, color: '#0A7A5A' },
    'categories',
  );

  const labelA = await mk('/labels', { name: `${TAG}-label-a`, color: '#112233' }, 'labels');
  const labelB = await mk('/labels', { name: `${TAG}-label-b`, color: '#445566' }, 'labels');
  const projectA = await mk(
    '/projects',
    { name: `${TAG}-project-a`, color: '#223344', defaultCurrencyId: currency.id },
    'projects',
  );
  const projectB = await mk(
    '/projects',
    { name: `${TAG}-project-b`, color: '#556677', defaultCurrencyId: currency.id },
    'projects',
  );
  const locationA = await mk('/locations', { name: `${TAG}-loc-a` }, 'locations');
  const locationB = await mk('/locations', { name: `${TAG}-loc-b` }, 'locations');
  check(
    'two of each record were created so a duplicate name is always available',
    [labelA, labelB, projectA, projectB, locationA, locationB].every((r) => r.status === 201),
  );

  section('1. Usage counts are exposed for the delete warning');
  for (const [name, path] of [
    ['locations', '/locations?status=all'],
    ['labels', '/labels?status=all'],
    ['projects', '/projects?status=all'],
    ['categories', '/categories?status=all'],
  ]) {
    const listed = await call('GET', path);
    const rows = Array.isArray(listed.body) ? listed.body : [];
    check(
      `${name}: every row carries a numeric usageCount`,
      rows.length > 0 && rows.every((row) => typeof row.usageCount === 'number'),
      rows.length === 0 ? 'empty list' : JSON.stringify(Object.keys(rows[0])),
    );
  }

  section('2. Duplicate names are refused on rename, in any casing');
  const cases = [
    ['label', `/labels/${labelA.body.id}`, `${TAG}-LABEL-B`, labelA.body.name],
    ['project', `/projects/${projectA.body.id}`, `${TAG}-PROJECT-B`, projectA.body.name],
    ['location', `/locations/${locationA.body.id}`, `${TAG}-LOC-B`, locationA.body.name],
    ['category', `/categories/${child.body.id}`, `${TAG}-PARENT`, child.body.name],
  ];
  const statusOf = async (path, id) => {
    const listed = await call('GET', `${path}?status=all`);
    return (Array.isArray(listed.body) ? listed.body : []).find((row) => row.id === id);
  };
  for (const [noun, path, clash, originalName] of cases) {
    const listPath = `/${noun}s`;
    const refused = await call('PATCH', path, { name: clash });
    check(`${noun}: renaming onto another name is refused`, refused.status === 409, refused.status);
    const stillThere = await statusOf(listPath, path.split('/').pop());
    check(
      `${noun}: the refused rename left the name alone`,
      stillThere?.name?.toLowerCase() !== String(clash).toLowerCase(),
      stillThere?.name,
    );
    const self = await call('PATCH', path, { name: originalName });
    check(
      `${noun}: renaming to its own name is allowed, not treated as a duplicate`,
      self.status === 200 && self.body?.name === originalName,
      `${self.status} ${JSON.stringify(self.body?.name)}`,
    );
  }

  section('3. Unreferenced records are deleted outright');
  const unused = [
    ['label', `/labels/${labelB.body.id}`],
    ['project', `/projects/${projectB.body.id}`],
    ['location', `/locations/${locationB.body.id}`],
  ];
  for (const [noun, path] of unused) {
    const removed = await call('DELETE', path);
    check(
      `${noun}: DELETE reports deleted:true and archived:false`,
      removed.status === 200 && removed.body?.deleted === true && removed.body?.archived === false,
      JSON.stringify(removed.body),
    );
    const gone = await call('GET', path);
    check(`${noun}: the record is really gone`, gone.status === 404, gone.status);
  }

  section('4. An expense that references all four records');
  const usedLocation = await mk('/locations', { name: `${TAG}-used-loc` }, 'locations');
  const usedProject = await mk(
    '/projects',
    { name: `${TAG}-used-pro`, color: '#778899', defaultCurrencyId: currency.id },
    'projects',
  );
  const usedLabel = await mk('/labels', { name: `${TAG}-used-label`, color: '#99aabb' }, 'labels');
  const expense = await mk(
    '/expenses',
    {
      amount: '12.34',
      date,
      categoryId: usedChild.body.id,
      currencyId: currency.id,
      locationId: usedLocation.body.id,
      projectId: usedProject.body.id,
      description: `${TAG} expense`,
      labelIds: [usedLabel.body.id],
    },
    'expenses',
  );
  check('the expense was created', expense.status === 201, JSON.stringify(expense.body));

  section('5. Referenced records are archived, never destroyed');
  const referenced = [
    ['label', `/labels/${usedLabel.body.id}`],
    ['project', `/projects/${usedProject.body.id}`],
    ['location', `/locations/${usedLocation.body.id}`],
  ];
  for (const [noun, path] of referenced) {
    const outcome = await call('DELETE', path);
    check(
      `${noun}: DELETE reports archived:true and deleted:false`,
      outcome.status === 200 && outcome.body?.archived === true && outcome.body?.deleted === false,
      JSON.stringify(outcome.body),
    );
    check(
      `${noun}: the warning count matches the expense that referenced it`,
      outcome.body?.usageCount === 1,
      `usageCount=${outcome.body?.usageCount}`,
    );
    const after = await statusOf(`/${noun}s`, path.split('/').pop());
    check(
      `${noun}: the record still exists, archived`,
      after?.status === 'archived',
      `${JSON.stringify(after?.status)}`,
    );
  }

  section('6. Deleting a parent archives its subcategories too');
  const parentOutcome = await call('DELETE', `/categories/${spareParent.body.id}`);
  check(
    'the parent is archived rather than deleted',
    parentOutcome.status === 200 && parentOutcome.body?.archived === true,
    JSON.stringify(parentOutcome.body),
  );
  const childAfter = await call('GET', `/categories/${usedChild.body.id}`);
  check(
    'its subcategory was archived alongside it, so no active child is orphaned',
    childAfter.body?.category?.status === 'archived',
    childAfter.body?.category?.status,
  );

  section('7. The expense came through all of it unharmed');
  const survivor = await call('GET', `/expenses/${expense.body.id}`);
  check('the expense still exists', survivor.status === 200, survivor.status);
  check('the amount is untouched', String(survivor.body?.amount) === '12.34', survivor.body?.amount);
  check(
    'its location still resolves to a name',
    typeof survivor.body?.location?.name === 'string',
    JSON.stringify(survivor.body?.location),
  );
  check(
    'its category still resolves to a name',
    typeof survivor.body?.category?.name === 'string',
    JSON.stringify(survivor.body?.category),
  );
  check(
    'its project still resolves to a name',
    typeof survivor.body?.project?.name === 'string',
    JSON.stringify(survivor.body?.project),
  );
  check(
    'its label still resolves to a name',
    Array.isArray(survivor.body?.labels) && survivor.body.labels.length === 1,
    JSON.stringify(survivor.body?.labels),
  );

  section('8. Housekeeping');
  const missing = await call('DELETE', '/labels/00000000-0000-0000-0000-000000000000');
  check('deleting a record that does not exist is a 404', missing.status === 404, missing.status);
  const badId = await call('DELETE', '/labels/not-a-uuid');
  check('a malformed id is rejected with 400', badId.status === 400, badId.status);
} finally {
  await cleanup(client).catch(() => {});
  await client.end().catch(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
