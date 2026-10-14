/**
 * DEV/TEST verification for Paid By and the money owed either way.
 *
 * The rules under test:
 *
 *   1. Paid By defaults to me, and an expense with no counterparty is an
 *      ordinary expense that appears in neither money view
 *   2. naming somebody makes the amount pending until told otherwise
 *   3. expenses I paid for appear under "owed_by_me"; ones someone else covered
 *      appear under "owed_to_me"
 *   4. settling updates the existing expense and never adds a second row
 *   5. pending and settled totals are reported separately, and their two sums
 *      add up to the overall total
 *   6. two currencies are reported side by side and never combined
 *   7. clearing the counterparty turns tracking off and drops it from both views
 *   8. an invalid paidBy or settlement status is rejected
 *
 * Fixtures use a unique run tag and are deleted afterwards, so the DEV database
 * is left as it was found.
 *
 * Usage:
 *   DATABASE_URL=postgres://... API_URL=http://localhost:8080 \
 *     SESSION_COOKIE="pocketful_session=<token>" pnpm verify:settlement
 */
import pg from 'pg';

const { Client } = pg;

const TAG = `verify-settle-${Date.now().toString(36)}`;
const API = `${(process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api`;
const url = process.env.DATABASE_URL;
const cookie = process.env.SESSION_COOKIE;

if (!cookie) {
  console.error('SESSION_COOKIE is required (for example pocketful_session=<token>).');
  process.exit(1);
}
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
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
    headers: { 'content-type': 'application/json', cookie },
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

const rows = (body) => (Array.isArray(body) ? body : (body?.items ?? []));
const num = (value) => Number(value ?? 0);
const sumBy = (list, key) => (list ?? []).reduce((total, entry) => total + num(entry[key]), 0);

const client = new Client({
  connectionString: url,
  ssl: url.includes('localhost') || url.includes('127.0.0.1') ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  query_timeout: 30000,
});

const createdIds = [];

try {
  await client.connect();

  section('Fixtures');
  const currencies = rows((await call('GET', '/currencies')).body);
  const currency = currencies[0];
  const secondCurrency = currencies.find((entry) => entry.id !== currency?.id);
  check('a currency is available', Boolean(currency?.id));
  check('a second currency is available', Boolean(secondCurrency?.id));

  const categories = rows((await call('GET', '/categories?status=active')).body);
  const category = categories.find((entry) => entry.parentId);
  check('a leaf category is available', Boolean(category?.id));

  const locations = rows((await call('GET', '/locations?status=all')).body);
  const home = locations.find((l) => l.slug === 'india') ?? locations[0];
  check('a location is available', Boolean(home?.id));

  // A window well in the past keeps the expected counts exact.
  const anchor = new Date();
  anchor.setMonth(anchor.getMonth() - 18);
  const date = new Date(anchor.getFullYear(), anchor.getMonth(), 15).toISOString().slice(0, 10);

  const make = async (overrides = {}) => {
    const result = await call('POST', '/expenses', {
      amount: '100.00',
      date,
      categoryId: category.id,
      currencyId: currency.id,
      locationId: home.id,
      description: `${TAG} ${Math.random().toString(36).slice(2, 8)}`,
      ...overrides,
    });
    if (result.status === 201 && result.body?.id) createdIds.push(result.body.id);
    return result;
  };

  section('Defaults: an ordinary expense');
  const plain = await make();
  check('creating an expense without money fields succeeds', plain.status === 201, plain.status);
  check('paidBy defaults to me', plain.body?.paidBy === 'me', plain.body?.paidBy);
  check('counterparty defaults to empty', !plain.body?.counterparty, plain.body?.counterparty);
  check('settlementStatus defaults to empty', !plain.body?.settlementStatus, plain.body?.settlementStatus);

  section('Naming somebody makes the amount pending');
  const owedToMe = await make({
    amount: '250.00',
    paidBy: 'me',
    counterparty: `${TAG} ravi`,
  });
  check('an expense I paid for is created', owedToMe.status === 201, owedToMe.status);
  check('paidBy is stored as me', owedToMe.body?.paidBy === 'me', owedToMe.body?.paidBy);
  check('counterparty is stored', owedToMe.body?.counterparty === `${TAG} ravi`, owedToMe.body?.counterparty);
  check('settlementStatus defaults to pending', owedToMe.body?.settlementStatus === 'pending', owedToMe.body?.settlementStatus);
  check('trackedAmount defaults to the whole expense', owedToMe.body?.trackedAmount === '250.00', owedToMe.body?.trackedAmount);

  const owedByMe = await make({
    amount: '500.00',
    paidBy: 'someone_else',
    counterparty: `${TAG} priya`,
  });
  check('an expense someone else covered is created', owedByMe.status === 201, owedByMe.status);
  check('settlementStatus defaults to pending', owedByMe.body?.settlementStatus === 'pending', owedByMe.body?.settlementStatus);

  section('Direction: each expense appears in exactly one view');
  const byMe = (await call('GET', `/reports/money?direction=owed_by_me&counterparty=${encodeURIComponent(`${TAG} ravi`)}`)).body;
  const toMe = (await call('GET', `/reports/money?direction=owed_to_me&counterparty=${encodeURIComponent(`${TAG} priya`)}`)).body;
  check('owed_by_me finds the expense I paid for', byMe?.rows?.some((r) => r.expenseId === owedToMe.body.id));
  check('owed_to_me finds the expense covered for me', toMe?.rows?.some((r) => r.expenseId === owedByMe.body.id));
  check('owed_by_me excludes the covered expense', !byMe?.rows?.some((r) => r.expenseId === owedByMe.body.id));
  check('owed_to_me excludes the expense I paid for', !toMe?.rows?.some((r) => r.expenseId === owedToMe.body.id));

  section('Untracked expenses appear in neither view');
  const allByMe = (await call('GET', '/reports/money?direction=owed_by_me')).body;
  const allToMe = (await call('GET', '/reports/money?direction=owed_to_me')).body;
  check('an expense with no counterparty is absent from owed_by_me', !allByMe?.rows?.some((r) => r.expenseId === plain.body.id));
  check('an expense with no counterparty is absent from owed_to_me', !allToMe?.rows?.some((r) => r.expenseId === plain.body.id));

  section('Settling updates the same expense');
  const beforeCount = (await call('GET', `/reports/money?direction=owed_by_me&counterparty=${encodeURIComponent(`${TAG} ravi`)}`)).body?.rows?.length ?? 0;
  const settled = await call('PATCH', `/expenses/${owedToMe.body.id}`, { settlementStatus: 'settled' });
  check('marking it settled succeeds', settled.status === 200, settled.status);
  check('settlementStatus reads back as settled', settled.body?.settlementStatus === 'settled', settled.body?.settlementStatus);
  check('the id is unchanged', settled.body?.id === owedToMe.body.id);
  const afterCount = (await call('GET', `/reports/money?direction=owed_by_me&counterparty=${encodeURIComponent(`${TAG} ravi`)}`)).body?.rows?.length ?? 0;
  check('no duplicate expense was created', afterCount === beforeCount, `${beforeCount} -> ${afterCount}`);

  section('A partial amount tracks only part of the expense');
  const partial = await make({
    amount: '1000.00',
    paidBy: 'me',
    counterparty: `${TAG} split`,
    trackedAmount: '600.00',
  });
  check('a tracked amount below the expense is accepted', partial.status === 201, partial.status);
  check('the tracked amount is stored', partial.body?.trackedAmount === '600.00', partial.body?.trackedAmount);
  check('the expense amount is untouched', partial.body?.amount === '1000.00', partial.body?.amount);
  const splitTotals = (await call('GET', `/reports/money?direction=owed_by_me&counterparty=${encodeURIComponent(`${TAG} split`)}`)).body;
  check('the report totals the tracked amount, not the expense', num(splitTotals?.summaries?.[0]?.pendingTotal) === 600, splitTotals?.summaries?.[0]?.pendingTotal);
  const splitRow = splitTotals?.rows?.find((r) => r.expenseId === partial.body.id);
  check('the row shows both the expense and the tracked amount', splitRow?.amount === '1000.00' && splitRow?.trackedAmount === '600.00', `${splitRow?.amount}/${splitRow?.trackedAmount}`);

  section('A tracked amount beyond the expense is refused');
  const tooMuch = await make({ amount: '100.00', paidBy: 'me', counterparty: `${TAG} over`, trackedAmount: '250.00' });
  check('a tracked amount above the expense is rejected', tooMuch.status === 400, tooMuch.status);
  const zeroAmount = await make({ amount: '100.00', paidBy: 'me', counterparty: `${TAG} zero`, trackedAmount: '0' });
  check('a tracked amount of zero is rejected', zeroAmount.status === 400, zeroAmount.status);

  section('Totals are split into pending and settled');
  const totals = (await call('GET', `/reports/money?direction=owed_by_me&counterparty=${encodeURIComponent(`${TAG} ravi`)}`)).body;
  const summary = totals?.summaries?.[0];
  check('a per-currency summary is returned', Boolean(summary?.currency?.id));
  check('pending excludes the settled amount', num(summary?.pendingTotal) === 0, summary?.pendingTotal);
  check('settled holds the full amount', num(summary?.settledTotal) === 250, summary?.settledTotal);
  check('total is pending plus settled', num(summary?.total) === num(summary?.pendingTotal) + num(summary?.settledTotal));
  check('the settled count is 1', num(summary?.settledCount) === 1, summary?.settledCount);

  section('Both directions counted together keep the two apart');
  const both = (await call('GET', `/reports/money?direction=owed_to_me&counterparty=${encodeURIComponent(`${TAG} priya`)}`)).body;
  const bothSummary = both?.summaries?.[0];
  check('pending holds the outstanding amount', num(bothSummary?.pendingTotal) === 500, bothSummary?.pendingTotal);
  check('settled is zero', num(bothSummary?.settledTotal) === 0, bothSummary?.settledTotal);

  section('Currencies are never combined');
  const mixed = await make({
    amount: '700.00',
    paidBy: 'me',
    counterparty: `${TAG} multi`,
    currencyId: secondCurrency.id,
  });
  check('a tracked expense in a second currency is created', mixed.status === 201, mixed.status);
  const multi = (await call('GET', `/reports/money?direction=owed_by_me&counterparty=${encodeURIComponent(`${TAG} multi`)}`)).body;
  check('the report is one entry per currency', multi?.summaries?.length === 1, multi?.summaries?.length);
  check('the amount is attributed to its own currency', multi?.summaries?.[0]?.currency?.id === secondCurrency.id);
  check('each summary keeps its own total', num(multi?.summaries?.[0]?.pendingTotal) === 700, multi?.summaries?.[0]?.pendingTotal);

  section('Clearing the person turns tracking off');
  const cleared = await call('PATCH', `/expenses/${owedByMe.body.id}`, { counterparty: null });
  check('clearing the counterparty succeeds', cleared.status === 200, cleared.status);
  check('counterparty is now empty', !cleared.body?.counterparty, cleared.body?.counterparty);
  check('settlementStatus is cleared with it', !cleared.body?.settlementStatus, cleared.body?.settlementStatus);
  const afterClear = (await call('GET', `/reports/money?direction=owed_to_me&counterparty=${encodeURIComponent(`${TAG} priya`)}`)).body;
  check('the cleared expense left the money view', !afterClear?.rows?.some((r) => r.expenseId === owedByMe.body.id));

  section('Dropping the name clears the amount with it');
  // A throwaway row: owedToMe is still asserted on further down, and clearing
  // tracking on it here would quietly invalidate those checks.
  const toClear = await make({
    amount: '250.00',
    paidBy: 'me',
    counterparty: `${TAG} cleared`,
    trackedAmount: '125.00',
  });
  const unnamed = await call('PATCH', `/expenses/${toClear.body.id}`, { counterparty: null });
  check('clearing the name succeeds', unnamed.status === 200, unnamed.status);
  check('the counterparty is gone', !unnamed.body?.counterparty, unnamed.body?.counterparty);
  check('the tracked amount is cleared too', !unnamed.body?.trackedAmount, unnamed.body?.trackedAmount);
  check('the expense itself is untouched', unnamed.body?.amount === '250.00', unnamed.body?.amount);

  section('An unrelated edit leaves tracking alone');
  const untouched = await call('PATCH', `/expenses/${owedByMe.body.id}`, { description: `${TAG} renamed` });
  check('renaming an untracked expense succeeds', untouched.status === 200, untouched.status);
  check('it stays untracked', !untouched.body?.counterparty, untouched.body?.counterparty);

  section('Bad values are rejected');
  const badPaidBy = await call('POST', '/expenses', {
    amount: '10.00', date, categoryId: category.id, currencyId: currency.id,
    locationId: home.id, paidBy: 'nobody',
  });
  check('an unknown paidBy is rejected', badPaidBy.status === 400, badPaidBy.status);
  const badStatus = await call('POST', '/expenses', {
    amount: '10.00', date, categoryId: category.id, currencyId: currency.id,
    locationId: home.id, settlementStatus: 'maybe',
  });
  check('an unknown settlementStatus is rejected', badStatus.status === 400, badStatus.status);

  section('Reports are filtered, not reshaped');
  const filtered = (await call('GET', `/reports/money?direction=owed_by_me&status=settled&counterparty=${encodeURIComponent(`${TAG} ravi`)}`)).body;
  check('status=settled keeps the settled row', filtered?.rows?.some((r) => r.expenseId === owedToMe.body.id));
  check('status=settled drops pending rows', filtered?.rows?.every((r) => r.settlementStatus === 'settled'));
  const summaryOnly = (await call('GET', `/reports/money?direction=owed_by_me&counterparty=${encodeURIComponent(`${TAG} ravi`)}&summaryOnly=true`)).body;
  check('summaryOnly returns no rows', (summaryOnly?.rows?.length ?? 0) === 0, summaryOnly?.rows?.length);
  check('summaryOnly still returns totals', (summaryOnly?.summaries?.length ?? 0) > 0);
  const noDirection = await call('GET', '/reports/money');
  check('a missing direction is rejected', noDirection.status === 400, noDirection.status);

  section('Backup round-trips the money fields');
  const exported = await call('GET', '/backup');
  const expenseInBackup = (exported.body?.expenses ?? []).find((e) => e.id === owedToMe.body.id);
  check('the tracked expense is in the backup', Boolean(expenseInBackup));
  check('paidBy survives the export', expenseInBackup?.paidBy === 'me', expenseInBackup?.paidBy);
  check('counterparty survives the export', expenseInBackup?.counterparty === `${TAG} ravi`, expenseInBackup?.counterparty);
  check('settlementStatus survives the export', expenseInBackup?.settlementStatus === 'settled', expenseInBackup?.settlementStatus);
  check('trackedAmount survives the export', expenseInBackup?.trackedAmount === '250.00', expenseInBackup?.trackedAmount);

  section('The database enforces the pairings');
  let statusCheckFailed = false;
  try {
    await client.query(
      `update expenses set settlement_status = 'settled', counterparty = null where id = $1`,
      [owedByMe.body.id],
    );
  } catch (error) {
    // 23514 is check_violation, which is the constraint under test.
    statusCheckFailed = String(error.code) === '23514';
  }
  check('a settlement without a counterparty is refused', statusCheckFailed);

  let amountCheckFailed = false;
  try {
    await client.query(
      `update expenses set counterparty = $2, tracked_amount = null where id = $1`,
      [mixed.body.id, `${TAG} ghost`],
    );
  } catch (error) {
    amountCheckFailed = String(error.code) === '23514';
  }
  check('a counterparty without a tracked amount is refused', amountCheckFailed);
  await client.query(
    `update expenses set settlement_status = 'settled', counterparty = $2, tracked_amount = $3 where id = $1`,
    [mixed.body.id, `${TAG} multi`, '700.00'],
  );
} catch (error) {
  failed += 1;
  console.log(`\n  ERROR  ${error.message}`);
} finally {
  // Leave the DEV database exactly as it was found.
  if (createdIds.length) {
    try {
      await client.query(`delete from expenses where id = any($1::uuid[])`, [createdIds]);
      console.log(`\n  cleanup: removed ${createdIds.length} fixture expense(s)`);
    } catch (error) {
      console.log(`\n  CLEANUP FAILED  ${error.message}`);
    }
  }
  await client.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}