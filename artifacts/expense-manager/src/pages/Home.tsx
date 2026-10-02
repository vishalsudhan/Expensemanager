import { useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowRight, ArrowUpRight, CircleAlert, Plus, RotateCcw, TrendingUp, Wallet,
} from 'lucide-react';
import { getGetDashboardQueryKey, useGetDashboard } from '@workspace/api-client-react';
import type {
  CurrencyAmount, DashboardCategorySpending, DashboardProjectSpending, DashboardTrendBucket, ExpenseRecord,
} from '@workspace/api-client-react';
import { errorText, formatShortDate, formatTotals, money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type Granularity = 'day' | 'week' | 'month';

const shortDate = formatShortDate;
/** Adds up trend buckets per currency so the headline stays separated by currency. */
const sumBucketTotals = (buckets: readonly DashboardTrendBucket[]): CurrencyAmount[] => {
  const byCurrency = new Map<string, CurrencyAmount>();
  for (const bucket of buckets) {
    for (const entry of bucket.totals) {
      const current = byCurrency.get(entry.currency.id);
      byCurrency.set(entry.currency.id, {
        currency: entry.currency,
        total: (Number(current?.total ?? 0) + Number(entry.total)).toFixed(2),
        count: (current?.count ?? 0) + entry.count,
      });
    }
  }
  return [...byCurrency.values()];
};
const monthName = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date);
};
const bucketLabel = (value: string, granularity: Granularity) =>
  granularity === 'month' ? monthName(value) : shortDate(value);
const granularityLabels: Record<Granularity, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
const rangeCaption: Record<Granularity, string> = { day: 'Last 14 days', week: 'Last 8 weeks', month: 'Last 6 months' };

function CategoryMark({ color, icon }: { color: string; icon: string | null }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-[13px] text-[13px]" style={{ backgroundColor: `${color}1F`, color }}>
      {icon ? <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} /> : <Wallet size={16} strokeWidth={1.8} />}
    </span>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-secondary/35 px-4 py-3.5">
      <p className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 font-display text-[20px] font-semibold tracking-[-.035em] tabular-nums" data-testid={testId}>{value}</p>
    </div>
  );
}

function BreakdownRow({
  color, name, count, totals, testId, valueTestId,
}: {
  color: string | null; name: string; count: number; totals: CurrencyAmount[]; testId: string; valueTestId: string;
}) {
  // Each currency keeps its own bar, so shares are never compared across currencies.

  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? 'var(--muted-foreground)' }} />
          <span className="truncate text-sm font-semibold tracking-[-.01em]">{name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{count} {count === 1 ? 'entry' : 'entries'}</span>
        </div>
        <span className="shrink-0 text-right text-sm font-semibold tabular-nums" data-testid={valueTestId}>{formatTotals(totals)}</span>
      </div>
      <div className="mt-2 space-y-1">
        {totals.map((entry) => (
          <div key={entry.currency.id} className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(Math.round((entry.share ?? 0) * 100), 3)}%`,
                backgroundColor: color ?? 'var(--primary)',
              }}
              data-testid={`${testId}-bar-${entry.currency.code}`}
            />
          </div>
        ))}
        {!totals.length && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full w-full rounded-full" style={{ width: '3%', backgroundColor: color ?? 'var(--primary)' }} />
          </div>
        )}
      </div>
    </div>
  );
}

function RecentExpenseRow({ expense }: { expense: ExpenseRecord }) {
  const title = expense.description || expense.category.name;
  return (
    <Link
      href={`/expenses/${expense.id}`}
      className="group flex min-w-0 items-center gap-3 rounded-[18px] border border-border/70 bg-card px-3.5 py-3.5 transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_12px_36px_-30px_var(--hover-shadow)]"
      data-testid={`card-recent-expense-${expense.id}`}
    >
      <CategoryMark color={expense.category.color} icon={expense.category.icon} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[14px] font-semibold tracking-[-.02em]">{title}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {expense.category.name} · {expense.currency?.symbol} {expense.currency?.code} · {shortDate(expense.date)}{expense.project ? ` · ${expense.project.name}` : ''}
        </p>
      </div>
      <p className="shrink-0 font-display text-[14px] font-semibold tracking-[-.03em] tabular-nums">{money(expense.amount, expense.currency)}</p>
      <ArrowUpRight size={15} className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
    </Link>
  );
}

export function HomePage() {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const params = { granularity, recentLimit: 5 };
  const query = useGetDashboard(
    params,
    { query: { queryKey: getGetDashboardQueryKey(params), placeholderData: keepPreviousData } },
  );

  const dashboard = query.data;

  return (
    <div className="page-enter">
      <div className="mb-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.19em] text-primary">
        <span className="size-1.5 rounded-full bg-primary" /> YOUR OVERVIEW
      </div>
      <header className="flex flex-col gap-5 border-b border-border/80 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-[40px] font-semibold leading-none tracking-[-.055em] sm:text-[52px]" data-testid="heading-home">Home</h1>
          <p className="mt-4 max-w-[470px] text-[14px] leading-6 text-muted-foreground">A quiet look at where your money has been going.</p>
        </div>
        <Link href="/expenses/new" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="button-quick-add">
          <Plus size={16} /> Quick add
        </Link>
      </header>

      {query.isLoading ? (
        <div className="mt-7 space-y-5" aria-label="Loading dashboard" data-testid="status-home-loading">
          <Skeleton className="h-44 rounded-[24px]" />
          <Skeleton className="h-60 rounded-[24px]" />
          <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-52 rounded-[24px]" /><Skeleton className="h-52 rounded-[24px]" /></div>
        </div>
      ) : query.isError ? (
        <section className="mt-7 rounded-[22px] border border-destructive/25 bg-card px-6 py-9 text-center" data-testid="status-home-error">
          <div className="mx-auto grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert size={18} /></div>
          <p className="mt-4 font-display text-xl font-semibold">Your dashboard didn’t load.</p>
          <p className="mt-2 text-sm text-muted-foreground">{errorText(query.error)}</p>
          <Button onClick={() => query.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-home"><RotateCcw size={15} /> Try again</Button>
        </section>
      ) : dashboard && dashboard.summary.allTime.length === 0 && dashboard.recentExpenses.length === 0 ? (
        <section className="mt-7 rounded-[24px] border border-dashed border-border bg-card/55 px-6 py-12 text-center sm:py-16" data-testid="status-home-empty">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><Wallet size={21} strokeWidth={1.7} /></div>
          <p className="mt-5 font-display text-[23px] font-semibold tracking-[-.04em]">Nothing to tally up yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Add your first expense and this space will fill in with totals, trends, and breakdowns.</p>
          <Link href="/expenses/new" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground" data-testid="button-home-first-expense"><Plus size={15} /> Add your first expense</Link>
        </section>
      ) : dashboard ? (
        <div className="mt-7 space-y-5">
          <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-7" data-testid="section-total-spent">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Total spent · this month</p>
                <p className="mt-3 font-display text-[38px] font-semibold leading-none tracking-[-.06em] tabular-nums sm:text-[46px]" data-testid="text-total-month">{formatTotals(dashboard.summary.month)}</p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-[11px] font-semibold text-secondary-foreground" data-testid="text-total-alltime">
                <TrendingUp size={13} className="text-primary" /> {formatTotals(dashboard.summary.allTime)} all time
              </span>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border/70 pt-5 sm:max-w-md">
              <Stat label="Today" value={formatTotals(dashboard.summary.today)} testId="text-total-today" />
              <Stat label="This week" value={formatTotals(dashboard.summary.week)} testId="text-total-week" />
            </div>
          </section>

          <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-7" data-testid="section-spending-trend">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Spending trend</p>
                <p className="mt-2 font-display text-[22px] font-semibold tracking-[-.04em] tabular-nums" data-testid="text-trend-total">
                  {formatTotals(sumBucketTotals(dashboard.trend.buckets))}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{rangeCaption[dashboard.trend.granularity]} · {granularityLabels[dashboard.trend.granularity]}</p>
              </div>
              <div className={`flex rounded-xl border border-border bg-background p-1 ${query.isPlaceholderData ? 'opacity-70' : ''}`} role="tablist" aria-label="Trend granularity">
                {(['day', 'week', 'month'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={granularity === option}
                    onClick={() => setGranularity(option)}
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${granularity === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    data-testid={`button-trend-${option}`}
                  >
                    {granularityLabels[option]}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-7 flex h-36 items-end gap-1 sm:gap-2" data-testid="chart-spending-trend">
              {(() => {
                // Scale each currency against its own peak so the chart stays readable
                // without ever comparing values across currencies.
                const peaks = new Map<string, number>();
                for (const item of dashboard.trend.buckets) {
                  for (const entry of item.totals) {
                    peaks.set(entry.currency.id, Math.max(peaks.get(entry.currency.id) ?? 0, Number(entry.total)));
                  }
                }

                return dashboard.trend.buckets.map((bucket) => (
                  <div key={bucket.start} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-[2px]">
                    {bucket.totals.map((entry) => {
                      const peak = peaks.get(entry.currency.id) ?? 0;
                      const value = Number(entry.total);
                      const height = peak > 0 ? Math.max((value / peak) * 100, value > 0 ? 6 : 0) : 0;
                      return (
                        <div
                          key={entry.currency.id}
                          className="w-full rounded-t-[4px] bg-primary/45 transition-colors group-hover:bg-primary"
                          style={{ height: `${height}%` }}
                          title={`${bucketLabel(bucket.start, dashboard.trend.granularity)} · ${money(entry.total, entry.currency)}`}
                          data-testid={`bar-trend-${bucket.start}-${entry.currency.code}`}
                        />
                      );
                    })}
                    {!bucket.totals.length && (
                      <div
                        className="w-full rounded-t-[4px] bg-primary/20"
                        style={{ height: '2%' }}
                        data-testid={`bar-trend-${bucket.start}-empty`}
                      />
                    )}
                  </div>
                ));
              })()}
            </div>
            <div className="mt-3 flex justify-between text-[10px] font-semibold text-muted-foreground">
              <span>{bucketLabel(dashboard.trend.buckets[0]?.start ?? '', dashboard.trend.granularity)}</span>
              {dashboard.trend.buckets.length > 2 && <span className="hidden sm:inline">{bucketLabel(dashboard.trend.buckets[Math.floor(dashboard.trend.buckets.length / 2)]?.start ?? '', dashboard.trend.granularity)}</span>}
              <span>{bucketLabel(dashboard.trend.buckets[dashboard.trend.buckets.length - 1]?.start ?? '', dashboard.trend.granularity)}</span>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-category-spending">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-[17px] font-semibold tracking-[-.03em]">Spending breakdown</h2>
                <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">This month</span>
              </div>
              {dashboard.categorySpending.length ? (
                <div className="mt-5 space-y-4">
                  {dashboard.categorySpending.map((row: DashboardCategorySpending) => (
                    <BreakdownRow
                      key={row.category.id}
                      color={row.category.color}
                      name={row.category.name}
                      count={row.count}
                      totals={row.totals}
                      testId={`row-category-spending-${row.category.id}`}
                      valueTestId={`text-category-spending-${row.category.id}`}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">No spending recorded this month yet.</p>
              )}
            </section>

            <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-project-spending">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-[17px] font-semibold tracking-[-.03em]">Project spending</h2>
                <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">This month</span>
              </div>
              {dashboard.projectSpending.length ? (
                <div className="mt-5 space-y-4">
                  {dashboard.projectSpending.map((row: DashboardProjectSpending, index: number) => (
                    <BreakdownRow
                      key={row.project?.id ?? `none-${index}`}
                      color={row.project?.color ?? null}
                      name={row.project?.name ?? 'No project'}
                      count={row.count}
                      totals={row.totals}
                      testId={`row-project-spending-${row.project?.id ?? 'none'}`}
                      valueTestId={`text-project-spending-${row.project?.id ?? 'none'}`}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">No spending recorded this month yet.</p>
              )}
            </section>
          </div>

          <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-recent-expenses">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-[17px] font-semibold tracking-[-.03em]">Recent expenses</h2>
              <Link href="/expenses" className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline" data-testid="link-view-all-expenses">
                View all <ArrowRight size={13} />
              </Link>
            </div>
            {dashboard.recentExpenses.length ? (
              <div className="mt-4 space-y-2.5">
                {dashboard.recentExpenses.map((expense) => <RecentExpenseRow key={expense.id} expense={expense} />)}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No expenses yet. Add one to get started.</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default HomePage;
