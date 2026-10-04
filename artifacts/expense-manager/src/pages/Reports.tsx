import { useState, type ReactNode } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowUpRight, ChartNoAxesColumnIncreasing, ChevronLeft, ChevronRight, CircleDollarSign,
  Folder, Hash, MapPin, RotateCcw, Tag, Wallet,
} from 'lucide-react';
import {
  getGetCategoryReportsQueryKey, getGetLabelReportsQueryKey,
  getGetPeriodReportQueryKey, getGetProjectReportsQueryKey,
  useGetCategoryReports, useGetLabelReports, useGetPeriodReport, useGetProjectReports,
} from '@workspace/api-client-react';
import type {
  CurrencyAmount, PeriodReport, ReportCategory, ReportLabel, ReportMonthlyBucket, ReportProject,
} from '@workspace/api-client-react';
import { errorText, formatTotals, money } from '@/lib/format';
import { useLocations } from '@/hooks/use-locations';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type Tab = 'monthly' | 'weekly' | 'projects' | 'categories' | 'labels' | 'custom';
type TransactionType = 'total' | 'expense' | 'payment';

const transactionTypes: { key: TransactionType; label: string }[] = [
  { key: 'total', label: 'Total' },
  { key: 'expense', label: 'Expense' },
  { key: 'payment', label: 'Payment' },
];

const tabs: { key: Tab; label: string }[] = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'projects', label: 'Projects' },
  { key: 'categories', label: 'Categories' },
  { key: 'labels', label: 'Labels' },
  { key: 'custom', label: 'Custom range' },
];

const pad = (value: number) => String(value).padStart(2, '0');
const toIso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromIso = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const monthValue = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const addMonths = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() + months, 1);
const startOfWeek = (date: Date) => {
  const day = date.getDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
};
const longDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(fromIso(value));
const shortDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(fromIso(value));
const weekday = (value: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(fromIso(value));
const monthName = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(`${value}-01T12:00:00`));
const monthBounds = (value: string) => {
  const [year, month] = value.split('-').map(Number);
  return { from: `${value}-01`, to: toIso(new Date(year, month, 0)) };
};
interface ExpenseFilters {
  categoryId?: string; projectId?: string; labelId?: string; from?: string; to?: string;
}
const expensesHref = (filters: ExpenseFilters) => {
  const params = new URLSearchParams();
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.labelId) params.set('labelId', filters.labelId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const query = params.toString();
  return query ? `/expenses?${query}` : '/expenses';
};

/**
 * Adds each entry's share of the overall total within the same currency, so the
 * entity reports can draw a bar per currency without mixing them.
 */
function withSharesAgainst(
  totals: readonly CurrencyAmount[],
  overall: readonly CurrencyAmount[],
): CurrencyAmount[] {
  const overallByCurrency = new Map(overall.map((entry) => [entry.currency.id, Number(entry.total)]));
  return totals.map((entry) => {
    const base = overallByCurrency.get(entry.currency.id) ?? 0;
    return { ...entry, share: base > 0 ? Number(entry.total) / base : 0 };
  });
}

/** Largest single-currency total across all buckets, used to scale the bars. */
function peakByCurrency(buckets: readonly { totals: CurrencyAmount[] }[]): Map<string, number> {
  const peaks = new Map<string, number>();
  for (const bucket of buckets) {
    for (const entry of bucket.totals) {
      peaks.set(entry.currency.id, Math.max(peaks.get(entry.currency.id) ?? 0, Number(entry.total)));
    }
  }
  return peaks;
}

function DailyBarChart({ buckets, labelMode, testIdPrefix, containerTestId }: {
  buckets: PeriodReport['dailyTrend']; labelMode: 'date' | 'weekday'; testIdPrefix: string; containerTestId: string;
}) {
  const every = Math.max(1, Math.ceil(buckets.length / 7));
  // Each currency is scaled against its own peak so bars never mix currencies.
  const peaks = peakByCurrency(buckets);
  return (
    <div className="flex h-48 items-stretch gap-px sm:gap-[3px]" data-testid={containerTestId}>
      {buckets.map((bucket, index) => (
        <div key={bucket.date} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <div className="flex w-full flex-1 items-end justify-center">
            {bucket.totals.length ? bucket.totals.map((entry) => {
              const peak = peaks.get(entry.currency.id) ?? 0;
              const value = Number(entry.total);
              const height = peak > 0 ? Math.max((value / peak) * 100, value > 0 ? 6 : 0) : 0;
              return (
                <div
                  key={entry.currency.id}
                  className="w-full rounded-t-[3px] bg-primary/45 transition-colors group-hover:bg-primary"
                  style={{ height: `${height}%` }}
                  title={`${longDate(bucket.date)} · ${money(entry.total, entry.currency)}`}
                  role="img"
                  aria-label={`${longDate(bucket.date)} ${entry.currency.code}: ${money(entry.total, entry.currency)}`}
                  data-testid={`${testIdPrefix}-${bucket.date}-${entry.currency.code}`}
                />
              );
            }) : (
              <div
                className="w-full rounded-t-[3px] bg-primary/20"
                style={{ height: '2%' }}
                title={`${longDate(bucket.date)} · no spending`}
                data-testid={`${testIdPrefix}-${bucket.date}-empty`}
              />
            )}
          </div>
          <span className="h-3 truncate text-[9px] font-semibold text-muted-foreground">
            {index % every === 0 ? (labelMode === 'weekday' ? weekday(bucket.date) : String(fromIso(bucket.date).getDate())) : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function MonthlyTrendChart({ trend, color, testIdPrefix, monthHref }: {
  trend: ReportMonthlyBucket[]; color: string; testIdPrefix: string; monthHref?: (month: string) => string;
}) {
  const peaks = peakByCurrency(trend);
  return (
    <div className="flex h-36 items-end gap-2 border-b border-border/70 pb-2" data-testid={`chart-${testIdPrefix}`}>
      {trend.map((month) => {
        const value = month.totals.reduce((sum, entry) => sum + Number(entry.total), 0);
        const body = (
          <>
            <span className="text-[9px] tabular-nums text-muted-foreground">{value ? formatTotals(month.totals) : '—'}</span>
            <div className="flex h-[92px] w-full items-end justify-center gap-[1px]">
              {month.totals.length ? month.totals.map((entry) => {
                const peak = peaks.get(entry.currency.id) ?? 0;
                const amount = Number(entry.total);
                const height = peak > 0 ? Math.max((amount / peak) * 100, 5) : 0;
                return (
                  <div
                    key={entry.currency.id}
                    className="w-full max-w-4 rounded-t-md"
                    style={{ height: `${height}%`, backgroundColor: color, opacity: 0.85 }}
                    title={`${money(entry.total, entry.currency)}`}
                    data-testid={`${testIdPrefix}-${month.month}-${entry.currency.code}`}
                  />
                );
              }) : (
                <div className="h-[3px] w-full max-w-9 rounded-t-md" style={{ backgroundColor: color, opacity: 0.2 }} />
              )}
            </div>
            <span className="text-[10px] font-semibold text-muted-foreground">{monthName(month.month)}</span>
          </>
        );
        const className = 'group/month flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5 rounded-md transition-colors hover:bg-secondary/45';
        const ariaLabel = `${monthName(month.month)}: ${formatTotals(month.totals)}`;
        return monthHref
          ? <Link key={month.month} href={monthHref(month.month)} className={className} title={`View ${monthName(month.month)} expenses`} aria-label={`${ariaLabel}. View expenses`} data-testid={`${testIdPrefix}-${month.month}`}>{body}</Link>
          : <div key={month.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" aria-label={ariaLabel} data-testid={`${testIdPrefix}-${month.month}`}>{body}</div>;
      })}
    </div>
  );
}

interface BreakdownRow {
  key: string; name: string; color: string | null; sublabel: string; totals: CurrencyAmount[]; testId: string; href?: string;
}

function BreakdownBars({ rows }: { rows: BreakdownRow[] }) {
  return (
    <div className="space-y-3.5">
      {rows.map((row) => {
        const body = (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color ?? 'var(--muted-foreground)' }} />
                <span className="truncate text-sm font-semibold tracking-[-.01em]">{row.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{row.sublabel}</span>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-right text-sm font-semibold tabular-nums">
                <span data-testid={`${row.testId}-total`}>{formatTotals(row.totals)}</span>
                {row.href && <ArrowUpRight size={13} className="text-muted-foreground/60" />}
              </span>
            </div>
            <div className="mt-1.5 space-y-1" aria-hidden="true">
              {row.totals.length ? row.totals.map((entry) => (
                <div key={entry.currency.id} className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(Math.round((entry.share ?? 0) * 100), 3)}%`, backgroundColor: row.color ?? 'var(--primary)' }} />
                </div>
              )) : (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full w-full rounded-full" style={{ width: '3%', backgroundColor: row.color ?? 'var(--primary)' }} />
                </div>
              )}
            </div>
          </>
        );
        return row.href
          ? <Link key={row.key} href={row.href} className="block rounded-xl p-1.5 -m-1.5 transition-colors hover:bg-secondary/45" data-testid={row.testId}>{body}</Link>
          : <div key={row.key} data-testid={row.testId}>{body}</div>;
      })}
    </div>
  );
}

function SummaryCard({ label, value, hint, icon: Icon, testId, accent }: {
  label: string; value: string; hint: string; icon: typeof Wallet; testId: string; accent?: boolean;
}) {
  return (
    <section className={`rounded-[22px] border border-border/70 p-5 ${accent ? 'bg-secondary/50' : 'bg-card'}`}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground"><Icon size={15} className="text-primary" /> {label}</div>
      <p className="mt-4 font-display text-[32px] font-semibold leading-none tracking-[-.055em] tabular-nums" data-testid={testId}>{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </section>
  );
}

function PeriodReportView({
  from, to, dailyLabel, locationId, transactionType,
}: {
  from: string; to: string; dailyLabel: 'date' | 'weekday';
  locationId?: string; transactionType: TransactionType;
}) {
  const params = { from, to, transactionType, ...(locationId ? { locationId } : {}) };
  const query = useGetPeriodReport(params, {
    query: { queryKey: getGetPeriodReportQueryKey(params), placeholderData: keepPreviousData },
  });
  const report = query.data;

  if (query.isLoading) {
    return (
      <div className="space-y-5" data-testid="status-reports-loading">
        <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((n) => <Skeleton key={n} className="h-28 rounded-[22px]" />)}</div>
        <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-56 rounded-[24px]" /><Skeleton className="h-56 rounded-[24px]" /></div>
        <Skeleton className="h-64 rounded-[24px]" />
      </div>
    );
  }

  if (query.isError || !report) {
    return (
      <section className="rounded-[22px] border border-destructive/25 bg-card px-6 py-9 text-center" data-testid="status-reports-error">
        <p className="font-display text-xl font-semibold">This report didn’t load.</p>
        <p className="mt-2 text-sm text-muted-foreground">{errorText(query.error)}</p>
        <Button onClick={() => query.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-reports"><RotateCcw size={15} /> Try again</Button>
      </section>
    );
  }

  const { summary } = report;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Total spending" value={formatTotals(summary.totals)} hint={`${longDate(from)} – ${longDate(to)}`} icon={CircleDollarSign} testId="text-report-total" accent />
        <SummaryCard label="Expenses" value={String(summary.count)} hint={`${summary.count === 1 ? 'expense' : 'expenses'} recorded`} icon={Wallet} testId="text-report-count" />
        <SummaryCard label="Average expense" value={summary.averages.map((entry) => money(entry.amount, entry.currency)).join(' · ')} hint="Average per expense, per currency" icon={ChartNoAxesColumnIncreasing} testId="text-report-average" />
      </div>

      <div className="flex justify-end">
        <Link href={expensesHref({ from, to })} className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline" data-testid="link-report-period-expenses">
          View these {summary.count === 1 ? 'expense' : 'expenses'} <ArrowUpRight size={14} />
        </Link>
      </div>

      {summary.count === 0 ? (
        <section className="rounded-[24px] border border-dashed border-border bg-card/55 px-6 py-12 text-center sm:py-16" data-testid="status-reports-empty">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><ChartNoAxesColumnIncreasing size={21} strokeWidth={1.7} /></div>
          <p className="mt-5 font-display text-[23px] font-semibold tracking-[-.04em]">No spending in this range.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Try a different month, week, or date range to see a report.</p>
        </section>
      ) : (
        <>
          {report.locationBreakdown.length > 0 && (
            <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-report-location">
              <div className="flex items-center justify-between gap-3"><h2 className="font-display text-[17px] font-semibold tracking-[-0.03em]">By location</h2><span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">{report.locationBreakdown.length} total</span></div>
              <div className="mt-5">
                <BreakdownBars rows={report.locationBreakdown.map((row) => ({ key: row.location.id, name: row.location.name, color: null, sublabel: `${row.count} ${row.count === 1 ? 'expense' : 'expenses'}`, totals: row.totals, testId: `row-report-location-${row.location.slug}` }))} />
              </div>
            </section>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-report-category">
              <div className="flex items-center justify-between gap-3"><h2 className="font-display text-[17px] font-semibold tracking-[-.03em]">By category</h2><span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">{report.categoryBreakdown.length} total</span></div>
              <div className="mt-5">
                {report.categoryBreakdown.length
                  ? <BreakdownBars rows={report.categoryBreakdown.map((row) => ({ key: row.category.id, name: row.category.name, color: row.category.color, sublabel: `${row.count} ${row.count === 1 ? 'expense' : 'expenses'}`, totals: row.totals, testId: `row-report-category-${row.category.id}`, href: expensesHref({ categoryId: row.category.id, from, to }) }))} />
                  : <p className="text-sm text-muted-foreground">No category spending in this range.</p>}
              </div>
            </section>
            <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-report-project">
              <div className="flex items-center justify-between gap-3"><h2 className="font-display text-[17px] font-semibold tracking-[-.03em]">By project</h2><span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">{report.projectBreakdown.length} total</span></div>
              <div className="mt-5">
                {report.projectBreakdown.length
                  ? <BreakdownBars rows={report.projectBreakdown.map((row, index) => ({ key: row.project?.id ?? `none-${index}`, name: row.project?.name ?? 'No project', color: row.project?.color ?? null, sublabel: `${row.count} ${row.count === 1 ? 'expense' : 'expenses'}`, totals: row.totals, testId: `row-report-project-${row.project?.id ?? 'none'}`, href: row.project ? expensesHref({ projectId: row.project.id, from, to }) : undefined }))} />
                  : <p className="text-sm text-muted-foreground">No project spending in this range.</p>}
              </div>
            </section>
          </div>

          {report.labelBreakdown.length > 0 && (
            <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-report-label">
              <div className="flex items-center justify-between gap-3"><h2 className="font-display text-[17px] font-semibold tracking-[-.03em]">By label</h2><span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Overlaps possible</span></div>
              <div className="mt-5">
                <BreakdownBars rows={report.labelBreakdown.map((row) => ({ key: row.label.id, name: row.label.name, color: row.label.color, sublabel: `${row.count} ${row.count === 1 ? 'expense' : 'expenses'}`, totals: row.totals, testId: `row-report-label-${row.label.id}`, href: expensesHref({ labelId: row.label.id, from, to }) }))} />
              </div>
            </section>
          )}

          <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-report-daily">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-[17px] font-semibold tracking-[-.03em]">Daily breakdown</h2>
              <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">{summary.days} {summary.days === 1 ? 'day' : 'days'}</span>
            </div>
            <div className="mt-6">
              <DailyBarChart buckets={report.dailyTrend} labelMode={dailyLabel} testIdPrefix="bar-report-daily" containerTestId="chart-report-daily" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function EntityEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <section className="rounded-[24px] border border-dashed border-border bg-card/55 px-6 py-12 text-center sm:py-16" data-testid="status-reports-empty">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><ChartNoAxesColumnIncreasing size={21} strokeWidth={1.7} /></div>
      <p className="mt-5 font-display text-[23px] font-semibold tracking-[-.04em]">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{hint}</p>
    </section>
  );
}

function ReportError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <section className="rounded-[22px] border border-destructive/25 bg-card px-6 py-9 text-center" data-testid="status-reports-error">
      <p className="font-display text-xl font-semibold">This report didn’t load.</p>
      <p className="mt-2 text-sm text-muted-foreground">{errorText(error)}</p>
      <Button onClick={onRetry} variant="outline" className="mt-5 gap-2" data-testid="button-retry-reports"><RotateCcw size={15} /> Try again</Button>
    </section>
  );
}

function ReportsSkeleton() {
  return (
    <div className="space-y-5" data-testid="status-reports-loading">
      <Skeleton className="h-24 rounded-[24px]" />
      <Skeleton className="h-72 rounded-[24px]" />
      <Skeleton className="h-72 rounded-[24px]" />
    </div>
  );
}

function EntityHeader({ icon: Icon, color, title, to, count, totals, idPrefix, expensesHref: viewHref, expensesTestId }: {
  icon: typeof Folder; color: string; title: string; to?: string; count: number; totals: CurrencyAmount[]; idPrefix: string; expensesHref?: string; expensesTestId?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-[14px]" style={{ backgroundColor: `${color}1F`, color }} data-testid={`icon-report-${idPrefix}`}><Icon size={18} strokeWidth={1.8} /></span>
        <div className="min-w-0">
          {to
            ? <Link href={to} className="font-display text-[17px] font-semibold tracking-[-.03em] hover:text-primary" data-testid={`link-report-${idPrefix}`}>{title}</Link>
            : <p className="font-display text-[17px] font-semibold tracking-[-.03em]" data-testid={`text-report-${idPrefix}-name`}>{title}</p>}
          <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid={`text-report-${idPrefix}-count`}>{count} {count === 1 ? 'expense' : 'expenses'}</p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <p className="font-display text-[22px] font-semibold tracking-[-.04em] tabular-nums" data-testid={`text-report-${idPrefix}-total`}>{formatTotals(totals)}</p>
        {viewHref && <Link href={viewHref} className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline" data-testid={expensesTestId}>View all expenses <ArrowUpRight size={12} /></Link>}
      </div>
    </div>
  );
}

function ProjectReportCard({ report }: { report: ReportProject }) {
  const { project } = report;
  return (
    <article className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid={`row-report-project-${project.id}`}>
      <EntityHeader icon={Folder} color={project.color} title={project.name} to={`/projects/${project.id}`} count={report.count} totals={report.totals} idPrefix={`project-${project.id}`} expensesHref={expensesHref({ projectId: project.id })} expensesTestId={`link-report-project-${project.id}-expenses`} />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Monthly trend · last 6 months</p>
          <MonthlyTrendChart trend={report.monthlyTrend} color={project.color} testIdPrefix={`report-project-trend-${project.id}`} monthHref={(month) => { const bounds = monthBounds(month); return expensesHref({ projectId: project.id, from: bounds.from, to: bounds.to }); }} />
        </div>
        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">By category</p>
          {report.categoryBreakdown.length
            ? <BreakdownBars rows={report.categoryBreakdown.map((row) => ({ key: row.category.id, name: row.category.name, color: row.category.color, sublabel: `${row.count} ${row.count === 1 ? 'expense' : 'expenses'}`, totals: withSharesAgainst(row.totals, report.totals), testId: `row-report-project-category-${project.id}-${row.category.id}`, href: expensesHref({ projectId: project.id, categoryId: row.category.id }) }))} />
            : <p className="text-sm text-muted-foreground">No category spending yet.</p>}
        </div>
      </div>
    </article>
  );
}

function CategoryReportCard({ report }: { report: ReportCategory }) {
  const { category } = report;
  return (
    <article className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid={`row-report-category-${category.id}`}>
      <EntityHeader icon={Tag} color={category.color} title={category.name} to={`/categories/${category.id}`} count={report.count} totals={report.totals} idPrefix={`category-${category.id}`} expensesHref={expensesHref({ categoryId: category.id })} expensesTestId={`link-report-category-${category.id}-expenses`} />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Monthly trend · last 6 months</p>
          <MonthlyTrendChart trend={report.monthlyTrend} color={category.color} testIdPrefix={`report-category-trend-${category.id}`} monthHref={(month) => { const bounds = monthBounds(month); return expensesHref({ categoryId: category.id, from: bounds.from, to: bounds.to }); }} />
        </div>
        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">By project</p>
          {report.projectDistribution.length
            ? <BreakdownBars rows={report.projectDistribution.map((row, index) => ({ key: row.project?.id ?? `none-${index}`, name: row.project?.name ?? 'No project', color: row.project?.color ?? null, sublabel: `${row.count} ${row.count === 1 ? 'expense' : 'expenses'}`, totals: withSharesAgainst(row.totals, report.totals), testId: `row-report-category-project-${category.id}-${row.project?.id ?? 'none'}`, href: row.project ? expensesHref({ categoryId: category.id, projectId: row.project.id }) : undefined }))} />
            : <p className="text-sm text-muted-foreground">No project spending yet.</p>}
        </div>
      </div>
    </article>
  );
}

function LabelReportCard({ report }: { report: ReportLabel }) {
  const { label } = report;
  return (
    <article className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid={`row-report-label-${label.id}`}>
      <EntityHeader icon={Hash} color={label.color} title={label.name} count={report.count} totals={report.totals} idPrefix={`label-${label.id}`} expensesHref={expensesHref({ labelId: label.id })} expensesTestId={`link-report-label-${label.id}-expenses`} />
      <div className="mt-6">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Monthly trend · last 6 months</p>
        <MonthlyTrendChart trend={report.monthlyTrend} color={label.color} testIdPrefix={`report-label-trend-${label.id}`} monthHref={(month) => { const bounds = monthBounds(month); return expensesHref({ labelId: label.id, from: bounds.from, to: bounds.to }); }} />
      </div>
    </article>
  );
}

function ProjectReports({ locationId, transactionType }: { locationId?: string; transactionType: TransactionType }) {
  const params = { months: 6, transactionType, ...(locationId ? { locationId } : {}) };
  const query = useGetProjectReports(params, { query: { queryKey: getGetProjectReportsQueryKey(params) } });
  if (query.isLoading) return <ReportsSkeleton />;
  if (query.isError) return <ReportError error={query.error} onRetry={() => query.refetch()} />;
  const active = (query.data ?? []).filter((report) => report.count > 0);
  const hidden = (query.data ?? []).length - active.length;
  if (!active.length) return <EntityEmpty title="No project spending yet." hint="Add expenses to a project and its report will appear here." />;
  return (
    <div className="space-y-5">
      {active.map((report) => <ProjectReportCard key={report.project.id} report={report} />)}
      {hidden > 0 && <p className="text-[11px] text-muted-foreground" data-testid="text-report-projects-hidden">{hidden} {hidden === 1 ? 'project has' : 'projects have'} no spending yet.</p>}
    </div>
  );
}

function CategoryReports({ locationId, transactionType }: { locationId?: string; transactionType: TransactionType }) {
  const params = { months: 6, transactionType, ...(locationId ? { locationId } : {}) };
  const query = useGetCategoryReports(params, { query: { queryKey: getGetCategoryReportsQueryKey(params) } });
  if (query.isLoading) return <ReportsSkeleton />;
  if (query.isError) return <ReportError error={query.error} onRetry={() => query.refetch()} />;
  const active = (query.data ?? []).filter((report) => report.count > 0);
  const hidden = (query.data ?? []).length - active.length;
  if (!active.length) return <EntityEmpty title="No category spending yet." hint="Add a few expenses and category reports will appear here." />;
  return (
    <div className="space-y-5">
      {active.map((report) => <CategoryReportCard key={report.category.id} report={report} />)}
      {hidden > 0 && <p className="text-[11px] text-muted-foreground" data-testid="text-report-categories-hidden">{hidden} {hidden === 1 ? 'category has' : 'categories have'} no spending yet.</p>}
    </div>
  );
}

function LabelReports({ locationId, transactionType }: { locationId?: string; transactionType: TransactionType }) {
  const params = { months: 6, transactionType, ...(locationId ? { locationId } : {}) };
  const query = useGetLabelReports(params, { query: { queryKey: getGetLabelReportsQueryKey(params) } });
  if (query.isLoading) return <ReportsSkeleton />;
  if (query.isError) return <ReportError error={query.error} onRetry={() => query.refetch()} />;
  const active = (query.data ?? []).filter((report) => report.count > 0);
  const hidden = (query.data ?? []).length - active.length;
  if (!active.length) return <EntityEmpty title="No label spending yet." hint="Tag some expenses with labels and their reports will appear here." />;
  return (
    <div className="space-y-5">
      {active.map((report) => <LabelReportCard key={report.label.id} report={report} />)}
      {hidden > 0 && <p className="text-[11px] text-muted-foreground" data-testid="text-report-labels-hidden">{hidden} {hidden === 1 ? 'label has' : 'labels have'} no spending yet.</p>}
    </div>
  );
}

function PeriodControls({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

const fieldClass = 'h-10 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('monthly');
  // Transaction type and location apply to every report view.
  const [transactionType, setTransactionType] = useState<TransactionType>('total');
  const { locations } = useLocations();
  const [locationId, setLocationId] = useState('');
  const current = today();
  const [month, setMonth] = useState(monthValue(current));
  const [weekStartDate, setWeekStartDate] = useState(startOfWeek(current));
  const [draftFrom, setDraftFrom] = useState(toIso(new Date(current.getFullYear(), current.getMonth(), 1)));
  const [draftTo, setDraftTo] = useState(toIso(current));
  const [applied, setApplied] = useState({ from: toIso(new Date(current.getFullYear(), current.getMonth(), 1)), to: toIso(current) });
  const [customError, setCustomError] = useState('');

  const monthDate = fromIso(`${month}-01`);
  const monthFrom = toIso(monthDate);
  const monthTo = toIso(endOfMonth(monthDate));
  const weekFrom = toIso(weekStartDate);
  const weekTo = toIso(addDays(weekStartDate, 6));

  const applyCustom = () => {
    if (!draftFrom || !draftTo) { setCustomError('Choose both a start and an end date.'); return; }
    if (draftFrom > draftTo) { setCustomError('The start date must be on or before the end date.'); return; }
    setCustomError('');
    setApplied({ from: draftFrom, to: draftTo });
  };

  return (
    <div className="page-enter">
      <div className="mb-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.19em] text-primary">
        <span className="size-1.5 rounded-full bg-primary" /> YOUR REPORTS
      </div>
      <header className="border-b border-border/80 pb-8">
        <h1 className="font-display text-[40px] font-semibold leading-none tracking-[-.055em] sm:text-[52px]" data-testid="heading-reports">Reports</h1>
        <p className="mt-4 max-w-[520px] text-[14px] leading-6 text-muted-foreground">Look back at your spending by month, week, project, category, label, or any range you choose.</p>
        <p className="mt-3 text-xs text-muted-foreground" data-testid="text-report-hint">Select any total, row, or month to open the matching expenses.</p>
      </header>

      <div className="mt-7">
        <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground" id="label-reports-transaction-type">
          Transaction Type
        </span>
        <div
          className="mt-2 inline-flex gap-1 rounded-xl bg-secondary/65 p-1"
          role="group"
          aria-labelledby="label-reports-transaction-type"
          data-testid="group-report-transaction-type"
        >
          {transactionTypes.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={transactionType === item.key}
              onClick={() => setTransactionType(item.key)}
              className={`min-h-9 rounded-lg px-4 text-xs font-bold transition-colors ${transactionType === item.key ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              data-testid={`button-report-transaction-type-${item.key}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto pb-1" role="tablist" aria-label="Report or period">
        <div className="flex w-max gap-1 rounded-xl bg-secondary/65 p-1">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`min-h-9 whitespace-nowrap rounded-lg px-4 text-xs font-bold transition-colors ${tab === item.key ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              data-testid={`tab-reports-${item.key}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <MapPin size={15} className="text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">
              Location
            </span>
            <select
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              aria-label="Filter reports by location"
              className={fieldClass}
              data-testid="select-report-location"
            >
              <option value="">All locations</option>
              {(locations ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {tab === 'monthly' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PeriodControls>
                <Button variant="outline" size="icon" onClick={() => setMonth(monthValue(addMonths(monthDate, -1)))} aria-label="Previous month" data-testid="button-report-month-prev"><ChevronLeft size={16} /></Button>
                <input type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} aria-label="Report month" className={fieldClass} data-testid="input-report-month" />
                <Button variant="outline" size="icon" onClick={() => setMonth(monthValue(addMonths(monthDate, 1)))} aria-label="Next month" data-testid="button-report-month-next"><ChevronRight size={16} /></Button>
              </PeriodControls>
              <span className="text-xs font-semibold text-muted-foreground" data-testid="text-report-period-caption">{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(monthDate)}</span>
            </div>
            <PeriodReportView from={monthFrom} to={monthTo} dailyLabel="date" locationId={locationId || undefined} transactionType={transactionType} />
          </div>
        )}

        {tab === 'weekly' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PeriodControls>
                <Button variant="outline" size="icon" onClick={() => setWeekStartDate(addDays(weekStartDate, -7))} aria-label="Previous week" data-testid="button-report-week-prev"><ChevronLeft size={16} /></Button>
                <input type="date" value={weekFrom} onChange={(event) => event.target.value && setWeekStartDate(startOfWeek(fromIso(event.target.value)))} aria-label="Week of" className={fieldClass} data-testid="input-report-week" />
                <Button variant="outline" size="icon" onClick={() => setWeekStartDate(addDays(weekStartDate, 7))} aria-label="Next week" data-testid="button-report-week-next"><ChevronRight size={16} /></Button>
              </PeriodControls>
              <span className="text-xs font-semibold text-muted-foreground" data-testid="text-report-period-caption">{shortDate(weekFrom)} – {shortDate(weekTo)}</span>
            </div>
            <PeriodReportView from={weekFrom} to={weekTo} dailyLabel="weekday" locationId={locationId || undefined} transactionType={transactionType} />
          </div>
        )}

        {tab === 'custom' && (
          <div className="space-y-6">
            <form noValidate onSubmit={(event) => { event.preventDefault(); applyCustom(); }} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Start date
                <input type="date" value={draftFrom} max={draftTo || undefined} onChange={(event) => setDraftFrom(event.target.value)} className={fieldClass} data-testid="input-report-from" />
              </label>
              <label className="flex flex-col gap-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">End date
                <input type="date" value={draftTo} min={draftFrom || undefined} onChange={(event) => setDraftTo(event.target.value)} className={fieldClass} data-testid="input-report-to" />
              </label>
              <Button type="submit" className="h-10" data-testid="button-report-apply">Apply range</Button>
            </form>
            {customError && <p role="alert" aria-live="polite" className="text-xs font-semibold text-destructive" data-testid="status-report-custom-error">{customError}</p>}
            <PeriodReportView from={applied.from} to={applied.to} dailyLabel="date" locationId={locationId || undefined} transactionType={transactionType} />
          </div>
        )}

        {tab === 'projects' && <ProjectReports locationId={locationId || undefined} transactionType={transactionType} />}
        {tab === 'categories' && <CategoryReports locationId={locationId || undefined} transactionType={transactionType} />}
        {tab === 'labels' && <LabelReports locationId={locationId || undefined} transactionType={transactionType} />}
      </div>
    </div>
  );
}

export default ReportsPage;
