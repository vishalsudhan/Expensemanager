/**
 * DEV/TEST verification for the global Reports transaction-type filter.
 *
 * The rules under test:
 *
 *   1. transactionType defaults to "total", so omitting it counts both types
 *   2. total = expenses + payments, expense = real spending only,
 *      payment = bill settlements only
 *   3. a credit-card payment is never counted as spending in expense mode
 *   4. the filter is cumulative with the location filter and with the date range
 *   5. every breakdown on the page agrees with the summary: location, category,
 *      project, label, and the monthly/weekly trend
 *   6. the project, category and label reports honour it too
 *   7. /reports/locations honours it, even though the UI does not call it
 *   8. an unknown value is rejected
 *
 * Fixtures use a unique run tag and are deleted afterwards, so the DEV database
 * is left as it was found. The expenses list keeps its own expense|payment
 * filter and must not gain "total".
 *
 * Usage:
 *   DATABASE_URL=postgres://... API_URL=http://localhost:8080 pnpm verify:reports
 */
import pg from 'pg';

const { Client } = pg;

const TAG = `verify-rep-${Date.now().toString(36)}`;
const API = `${(process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api`;
const url = process.env.DATABASE_URL;
// Every /api route needs a session, so reuse an existing one rather than
// claiming the single account the way the fresh-database suites do.
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

const created = { expenses: [] };
const rows = (body) => (Array.isArray(body) ? body : (body?.items ?? []));
const totalOf = (report) =>
  report.summary.totals.reduce((sum, entry) => sum + Number(entry.total), 0);
const countOf = (report) =>
  report.summary.totals.reduce((sum, entry) => sum + Number(entry.count), 0);
const sumTotals = (list) => (list ?? []).reduce((sum, t) => sum + Number(t.total), 0);
const breakdownSum = (rowsIn) => (rowsIn ?? []).reduce((sum, row) => sum + sumTotals(row.totals), 0);
const trendSum = (report) => report.dailyTrend.reduce((sum, bucket) => sum + sumTotals(bucket.totals), 0);
const entitySum = (list) =>
  (list ?? []).reduce((sum, entry) => sum + sumTotals(entry.totals), 0);

const client = new Client({
  connectionString: url,
  ssl: url.includes('localhost') || url.includes('127.0.0.1') ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  query_timeout: 30000,
});

try {
  await client.connect();

  section('Fixtures: one expense and one credit-card payment per location');
  const currencies = rows((await call('GET', '/currencies')).body);
  const currency = currencies[0];
  check('a currency is available', Boolean(currency?.id));

  const categories = rows((await call('GET', '/categories?status=active')).body);
  // Expenses must point at a leaf category.
  const category = categories.find((entry) => entry.parentId);
  check('a leaf category is available', Boolean(category?.id));

  const locations = rows((await call('GET', '/locations?status=all')).body);
  const home = locations.find((l) => l.slug === 'india') ?? locations[0];
  const away = locations.find((l) => l.slug === 'qatar') ?? locations[1];
  check('two distinct locations are available', Boolean(home?.id && away?.id && home.id !== away.id));

  const projects = rows((await call('GET', '/projects?status=all')).body);
  const project = projects[0];
  const labels = rows((await call('GET', '/labels?status=all')).body);
  const label = labels[0];

  // A window well in the past keeps the expected counts exact: nothing else
  // should be recorded then, so the assertions cannot be skewed by other data.
  const anchor = new Date();
  anchor.setMonth(anchor.getMonth() - 18);
  const date = new Date(anchor.getFullYear(), anchor.getMonth(), 15).toISOString().slice(0, 10);
  const from = `${date.slice(0, 7)}-01`;
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  const make = async (amount, location, transactionType) => {
    const result = await call('POST', '/expenses', {
      amount,
      date,
      categoryId: category.id,
      currencyId: currency.id,
      locationId: location.id,
      ...(project ? { projectId: project.id } : {}),
      ...(label ? { labelIds: [label.id] } : {}),
      ...(transactionType ? { transactionType } : {}),
      description: `${TAG} ${amount} ${transactionType ?? 'expense'} ${location.slug}`,
    });
    if (result.body?.id) created.expenses.push(result.body.id);
    return result;
  };

  // home: 100 expense + 100 payment. away: 40 expense + 40 payment.
  await make('100.00', home, undefined);
  await make('100.00', home, 'payment');
  await make('40.00', away, undefined);
  await make('40.00', away, 'payment');
  check('four fixtures created', created.expenses.length === 4, created.expenses.length);

  const range = (extra = '') => `/reports/period?from=${from}&to=${to}${extra}`;

  section('1. Default is total');
  const implicit = (await call('GET', range())).body;
  const explicit = (await call('GET', range('&transactionType=total'))).body;
  check('omitting transactionType behaves as total', countOf(implicit) === countOf(explicit),
    `${countOf(implicit)} vs ${countOf(explicit)}`);

  section('2. Total counts both types');
  const total = (await call('GET', range('&transactionType=total'))).body;
  check('total counts 4 transactions', countOf(total) === 4, countOf(total));
  check('total sums 280', Math.abs(totalOf(total) - 280) < 0.01, totalOf(total));

  section('3. Expense excludes the credit-card payment');
  const expense = (await call('GET', range('&transactionType=expense'))).body;
  check('expense counts only the 2 expenses', countOf(expense) === 2, countOf(expense));
  check('expense sums 140, not 280', Math.abs(totalOf(expense) - 140) < 0.01, totalOf(expense));
  const payments = rows((await call('GET', `/expenses?from=${from}&to=${to}&transactionType=payment`)).body);
  check('the payments really do exist in the data', payments.length === 2, payments.length);
  check('the expenses list still offers expense|payment only',
    (await call('GET', range('&transactionType=bogus'))).status === 400);

  section('4. Payment counts settlements only');
  const payment = (await call('GET', range('&transactionType=payment'))).body;
  check('payment counts only the 2 payments', countOf(payment) === 2, countOf(payment));
  check('payment sums 140', Math.abs(totalOf(payment) - 140) < 0.01, totalOf(payment));

  section('5. Cumulative with the location filter');
  const expenseHome = (await call('GET', range(`&transactionType=expense&locationId=${home.id}`))).body;
  check('expense + home location -> 1 transaction, 100',
    countOf(expenseHome) === 1 && Math.abs(totalOf(expenseHome) - 100) < 0.01,
    `${countOf(expenseHome)} / ${totalOf(expenseHome)}`);
  const paymentAway = (await call('GET', range(`&transactionType=payment&locationId=${away.id}`))).body;
  check('payment + away location -> 1 transaction, 40',
    countOf(paymentAway) === 1 && Math.abs(totalOf(paymentAway) - 40) < 0.01,
    `${countOf(paymentAway)} / ${totalOf(paymentAway)}`);
  const totalAway = (await call('GET', range(`&transactionType=total&locationId=${away.id}`))).body;
  check('total + away location -> both types, 80',
    countOf(totalAway) === 2 && Math.abs(totalOf(totalAway) - 80) < 0.01,
    `${countOf(totalAway)} / ${totalOf(totalAway)}`);

  section('6. Cumulative with the date range');
  const singleDay = (await call('GET', `/reports/period?from=${date}&to=${date}&transactionType=expense`)).body;
  check('a single-day range + expense -> the 2 expenses', countOf(singleDay) === 2, countOf(singleDay));
  const empty = (await call('GET', '/reports/period?from=2000-01-01&to=2000-01-02&transactionType=total')).body;
  check('a range with no data -> zero transactions', countOf(empty) === 0, countOf(empty));

  section('7. Every breakdown agrees with the summary');
  for (const [label, report] of [['total', total], ['expense', expense], ['payment', payment]]) {
    check(`${label}: location breakdown present`, report.locationBreakdown.length > 0, report.locationBreakdown.length);
    check(`${label}: category breakdown present`, report.categoryBreakdown.length > 0, report.categoryBreakdown.length);
    check(`${label}: label breakdown present`, report.labelBreakdown.length > 0, report.labelBreakdown.length);
    check(`${label}: daily trend present`, report.dailyTrend.length > 0, report.dailyTrend.length);
    // The trend used to ignore the filter entirely, which is what these catch.
    check(`${label}: trend total matches the summary`,
      Math.abs(trendSum(report) - totalOf(report)) < 0.01, `${trendSum(report)} vs ${totalOf(report)}`);
    check(`${label}: location breakdown total matches the summary`,
      Math.abs(breakdownSum(report.locationBreakdown) - totalOf(report)) < 0.01,
      `${breakdownSum(report.locationBreakdown)} vs ${totalOf(report)}`);
    check(`${label}: category breakdown total matches the summary`,
      Math.abs(breakdownSum(report.categoryBreakdown) - totalOf(report)) < 0.01,
      `${breakdownSum(report.categoryBreakdown)} vs ${totalOf(report)}`);
  }
  check('the trend differs between total and expense, proving it is filtered',
    Math.abs(trendSum(total) - trendSum(expense)) > 0.01, `${trendSum(total)} vs ${trendSum(expense)}`);

  section('8. Project, category and label reports');
  // These reports are month-window based rather than date based, so the window
  // has to be wide enough to reach the fixtures (months is capped at 24).
  const WIDE = 'months=24';
  for (const name of ['projects', 'categories', 'labels']) {
    const all = (await call('GET', `/reports/${name}?${WIDE}&transactionType=total`)).body;
    const onlyExpense = (await call('GET', `/reports/${name}?${WIDE}&transactionType=expense`)).body;
    const onlyPayment = (await call('GET', `/reports/${name}?${WIDE}&transactionType=payment`)).body;
    check(`${name}: total >= expense`, entitySum(all) >= entitySum(onlyExpense) - 0.01,
      `${entitySum(all)} vs ${entitySum(onlyExpense)}`);
    check(`${name}: payment mode is not empty`, entitySum(onlyPayment) > 0, entitySum(onlyPayment));
  }
  const scoped = await call('GET', `/reports/categories?${WIDE}&transactionType=expense&locationId=${away.id}`);
  check('categories + expense + location is accepted', scoped.status === 200, scoped.status);

  section('9. /reports/locations honours the filter');
  const locTotal = (await call('GET', `/reports/locations?${WIDE}&transactionType=total`)).body;
  const locExpense = (await call('GET', `/reports/locations?${WIDE}&transactionType=expense`)).body;
  const locPayment = (await call('GET', `/reports/locations?${WIDE}&transactionType=payment`)).body;
  const locSum = (list) => entitySum(list);
  check('locations report: expense is less than total', locSum(locExpense) < locSum(locTotal),
    `${locSum(locExpense)} < ${locSum(locTotal)}`);
  check('locations report: payment mode is not empty', locSum(locPayment) > 0, locSum(locPayment));

  section('10. Trends: one chart, switchable series');
  const trendsFor = async (extra) => (await call('GET', `/reports/trends?from=${from}&to=${to}${extra}`)).body;
  const seriesTotal = (report, name) =>
    report.series.find((entry) => entry.name === name)?.totals ?? [];
  const sumTotals = (list) => (list ?? []).reduce((n, t) => n + Number(t.total), 0);

  const catTrends = await trendsFor('&groupBy=category');
  check('category grouping returns series and buckets', catTrends.series.length > 0 && catTrends.buckets.length > 0,
    `${catTrends.series.length}/${catTrends.buckets.length}`);
  check('every series carries a stable key, name and colour field',
    catTrends.series.every((entry) => typeof entry.key === 'string' && typeof entry.name === 'string' && 'color' in entry));
  check('series are never empty', catTrends.series.every((entry) => entry.count > 0 && sumTotals(entry.totals) > 0));

  // One currency per amount, always. This is what lets a reader chart safely.
  const duplicateCurrencies = catTrends.series.filter(
    (entry) => new Set(entry.totals.map((t) => t.currency.code)).size !== entry.totals.length,
  );
  check('no series lists the same currency twice', duplicateCurrencies.length === 0, duplicateCurrencies.map((e) => e.name).join(','));

  // Every point must add back up to its own series total, or the chart lies.
  let reconciles = true;
  for (const entry of catTrends.series) {
    const byCurrency = new Map();
    for (const bucket of catTrends.buckets) {
      for (const point of bucket.points) {
        if (point.seriesKey !== entry.key) continue;
        byCurrency.set(point.currency.code, (byCurrency.get(point.currency.code) ?? 0) + Number(point.total));
      }
    }
    for (const amount of entry.totals) {
      if (Math.abs((byCurrency.get(amount.currency.code) ?? 0) - Number(amount.total)) > 0.001) {
        reconciles = false;
      }
    }
  }
  check('bucket points add up to each series total', reconciles);

  for (const dimension of ['project', 'label', 'location', 'transactionType']) {
    const report = await trendsFor(`&groupBy=${dimension}`);
    check(`${dimension} grouping returns data`, report.series.length > 0, report.series.length);
  }
  const typeTrends = await trendsFor('&groupBy=transactionType');
  check('transaction-type grouping yields readable labels',
    typeTrends.series.some((e) => e.name === 'Expense') && typeTrends.series.some((e) => e.name === 'Payment'),
    typeTrends.series.map((e) => e.name).join(','));

  const expenseTrends = await trendsFor('&groupBy=transactionType&transactionType=expense');
  check('trends honour the transaction-type filter',
    expenseTrends.series.length === 1 && expenseTrends.series[0].name === 'Expense',
    expenseTrends.series.map((e) => e.name).join(','));
  const homeTrends = await trendsFor(`&groupBy=location&locationId=${home.id}`);
  check('trends honour the location filter',
    homeTrends.series.length === 1 && homeTrends.series[0].name === home.name,
    homeTrends.series.map((e) => e.name).join(','));

  const dayTrends = await trendsFor('&groupBy=category&granularity=day');
  const weekTrends = await trendsFor('&groupBy=category&granularity=week');
  const monthTrends = await trendsFor('&groupBy=category&granularity=month');
  check('day granularity is the finest', dayTrends.buckets.length >= weekTrends.buckets.length,
    `${dayTrends.buckets.length} vs ${weekTrends.buckets.length}`);
  check('month granularity collapses the range', monthTrends.buckets.length === 1, monthTrends.buckets.length);
  check('bucket keys are always full dates, never a bare month',
    [dayTrends, weekTrends, monthTrends].every((r) => r.buckets.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.key))),
    JSON.stringify(monthTrends.buckets.map((b) => b.key)));
  check('every granularity preserves the whole-range total',
    Math.abs(sumTotals(dayTrends.series.flatMap((e) => e.totals)) - 280) < 0.01
    && Math.abs(sumTotals(monthTrends.series.flatMap((e) => e.totals)) - 280) < 0.01,
    `${sumTotals(dayTrends.series.flatMap((e) => e.totals))}/${sumTotals(monthTrends.series.flatMap((e) => e.totals))}`);

  section('11. Validation');
  check('transactionType=bogus -> 400', (await call('GET', range('&transactionType=bogus'))).status === 400);
  check('trends with an unparseable date -> 400',
    (await call('GET', '/reports/trends?from=nope&to=2026-10-31')).status === 400);
  check('trends with an unknown groupBy -> 400',
    (await call('GET', `/reports/trends?from=${from}&to=${to}&groupBy=bogus`)).status === 400);
  check('trends with from after to -> 400',
    (await call('GET', `/reports/trends?from=${to}&to=${from}`)).status === 400);
} finally {
  if (created.expenses.length > 0) {
    await client
      .query('delete from expense_labels where expense_id = any($1::uuid[])', [created.expenses])
      .catch(() => {});
    await client.query('delete from expenses where id = any($1::uuid[])', [created.expenses]).catch(() => {});
  }
  await client.end().catch(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);