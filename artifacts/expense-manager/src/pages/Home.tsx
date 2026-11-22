import { keepPreviousData } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, CircleAlert, HandCoins, Plus, RotateCcw, Wallet,
} from 'lucide-react';
import { getGetDashboardQueryKey, useGetDashboard } from '@workspace/api-client-react';
import type { ExpenseRecord } from '@workspace/api-client-react';
import { errorText, formatShortDate, formatTotals, money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CountryMonthCards, TopCategoriesCard } from '@/components/home-overview';

const shortDate = formatShortDate;

function CategoryMark({ color, icon }: { color: string; icon: string | null }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-[13px] text-[13px]" style={{ backgroundColor: `${color}1F`, color }}>
      {icon ? <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} /> : <Wallet size={16} strokeWidth={1.8} />}
    </span>
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
  // Home needs only the owed/owing figures, recent expenses and the empty
  // state from the dashboard; the monthly figures come from the report overview.
  const params = { granularity: 'month' as const, recentLimit: 5 };
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
          <p className="mt-4 max-w-[470px] text-[14px] leading-6 text-muted-foreground">This month at a glance. The full picture is in Reports.</p>
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
          <CountryMonthCards />

          {(dashboard.settlements.owedToMe.length > 0 || dashboard.settlements.iOwe.length > 0) && (
            <Link
              href="/settlements"
              className="group grid gap-3 rounded-[24px] border border-border/70 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/25 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center sm:gap-6 sm:p-6"
              data-testid="card-home-settlements"
            >
              <span className="hidden size-10 place-items-center rounded-xl bg-secondary text-primary sm:grid"><HandCoins size={18} /></span>
              <div className="flex items-center gap-3">
                <ArrowDownLeft size={16} className="shrink-0 text-primary sm:hidden" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Owed to you</p>
                  <p className="mt-1 font-display text-[20px] font-semibold tracking-[-.035em] tabular-nums" data-testid="text-home-owed">{dashboard.settlements.owedToMe.length ? formatTotals(dashboard.settlements.owedToMe) : '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 border-t border-border/70 pt-3 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                <ArrowUpRight size={16} className="shrink-0 text-amber-600 sm:hidden" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">You owe</p>
                  <p className="mt-1 font-display text-[20px] font-semibold tracking-[-.035em] tabular-nums" data-testid="text-home-owing">{dashboard.settlements.iOwe.length ? formatTotals(dashboard.settlements.iOwe) : '—'}</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-primary">Details <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
            </Link>
          )}

          <TopCategoriesCard />

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
