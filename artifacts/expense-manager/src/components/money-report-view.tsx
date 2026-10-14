import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { keepPreviousData } from '@tanstack/react-query';
import {
  getGetMoneyReportQueryKey,
  useGetMoneyReport,
  type GetMoneyReportParams,
  type MoneyDirection,
} from '@workspace/api-client-react';
import { HandCoins, ReceiptText, TrendingUp } from 'lucide-react';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const fieldClass = 'h-10 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const headings: Record<MoneyDirection, { title: string; blurb: string; empty: string; hint: string }> = {
  owed_by_me: {
    title: 'Money to get back',
    blurb: 'Expenses you paid for that someone still owes you.',
    empty: 'Nothing to get back.',
    hint: 'Name someone as the person on an expense and it will show up here.',
  },
  owed_to_me: {
    title: 'Money to pay back',
    blurb: 'Expenses someone covered for you that you still owe.',
    empty: 'Nothing to pay back.',
    hint: 'Set who paid to someone else and it will show up here.',
  },
};

/**
 * One of the two owed-money views.
 *
 * Totals are always per currency and are never added together, so an INR
 * amount and a QAR amount sit side by side rather than pretending to be one
 * number. Marking something settled updates that expense in place, so the
 * outstanding figure drops without a second row appearing.
 */
export function MoneyReportView({ direction }: { direction: MoneyDirection }) {
  const [status, setStatus] = useState<'' | 'pending' | 'settled'>('');
  const [counterparty, setCounterparty] = useState('');
  const [appliedCounterparty, setAppliedCounterparty] = useState('');
  const heading = headings[direction];

  const params = useMemo<GetMoneyReportParams>(
    () => ({
      direction,
      ...(status ? { status } : {}),
      ...(appliedCounterparty ? { counterparty: appliedCounterparty } : {}),
    }),
    [direction, status, appliedCounterparty],
  );
  const query = useGetMoneyReport(params, {
    query: { queryKey: getGetMoneyReportQueryKey(params), placeholderData: keepPreviousData },
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-[22px]" />
        <Skeleton className="h-40 w-full rounded-[22px]" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-sm font-semibold text-destructive" data-testid="status-money-error">
        {heading.title} could not be loaded right now.
      </p>
    );
  }

  const summaries = query.data?.summaries ?? [];
  const rows = query.data?.rows ?? [];
  const perCounterparty = query.data?.counterpartyTotals ?? [];
  const totalRows = summaries.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div className="space-y-6" data-testid={`section-money-${direction}`}>
      <header className="space-y-1">
        <h3 className="font-display text-[17px] font-semibold tracking-[-.025em]" data-testid="text-money-title">
          {heading.title}
        </h3>
        <p className="text-xs text-muted-foreground">{heading.blurb}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            className={fieldClass}
            data-testid="select-money-status"
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="settled">{direction === 'owed_to_me' ? 'Paid back' : 'Received'}</option>
          </select>
        </label>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedCounterparty(counterparty.trim());
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="flex flex-col gap-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">
            Person
            <input
              value={counterparty}
              onChange={(event) => setCounterparty(event.target.value)}
              placeholder="Anyone"
              list="money-counterparty-names"
              className={fieldClass}
              data-testid="input-money-counterparty"
            />
            <datalist id="money-counterparty-names">
              {[...new Set(perCounterparty.map((entry) => entry.counterparty))]
                .sort((a, b) => a.localeCompare(b))
                .map((name) => (
                  <option key={name} value={name} />
                ))}
            </datalist>
          </label>
          <Button type="submit" className="h-10" data-testid="button-money-apply-person">
            Apply
          </Button>
          {appliedCounterparty && (
            <Button
              type="button"
              variant="ghost"
              className="h-10"
              onClick={() => {
                setCounterparty('');
                setAppliedCounterparty('');
              }}
              data-testid="button-money-clear-person"
            >
              Clear
            </Button>
          )}
        </form>
      </div>

      {summaries.length === 0 ? (
        <div
          className="rounded-[22px] border border-border/70 bg-card px-5 py-10 text-center"
          data-testid="section-money-empty"
        >
          <HandCoins className="mx-auto mb-3 text-muted-foreground" size={22} strokeWidth={1.7} />
          <p className="font-display text-[15px] font-semibold">{heading.empty}</p>
          <p className="mt-1 text-xs text-muted-foreground">{heading.hint}</p>
          <Link
            href="/expenses/new"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
          >
            <ReceiptText size={14} /> Record an expense
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {summaries.map((entry) => (
              <div
                key={entry.currency.id}
                className="rounded-[22px] border border-border/70 bg-card p-5"
                data-testid="card-money-total"
              >
                <p className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">
                  {entry.currency.code}
                </p>
                <p
                  className="mt-1 font-display text-[26px] font-semibold tracking-[-.03em] tabular-nums"
                  data-testid="text-money-pending-total"
                >
                  {money(entry.pendingTotal, entry.currency)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {entry.pendingCount} {entry.pendingCount === 1 ? 'item' : 'items'} pending
                  {entry.settledCount > 0 && (
                    <>
                      {' · '}
                      {money(entry.settledTotal, entry.currency)} {direction === 'owed_to_me' ? 'paid back' : 'received'}
                    </>
                  )}
                </p>
              </div>
            ))}
          </div>

          <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6">
            <h4 className="mb-3 font-display text-[15px] font-semibold tracking-[-.02em]">By person</h4>
            {perCounterparty.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nobody yet.</p>
            ) : (
              <ul className="space-y-2" data-testid="list-money-counterparties">
                {perCounterparty.map((entry) => (
                  <li
                    key={`${entry.counterparty}-${entry.currency.code}`}
                    className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0"
                  >
                    <button
                      type="button"
                      className="text-sm font-semibold hover:underline"
                      onClick={() => {
                        setCounterparty(entry.counterparty);
                        setAppliedCounterparty(entry.counterparty);
                      }}
                      data-testid={`button-money-counterparty-${entry.counterparty}`}
                    >
                      {entry.counterparty}
                    </button>
                    <span className="font-display text-sm font-semibold tabular-nums">
                      {money(entry.pendingTotal, entry.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6">
            <h4 className="mb-3 font-display text-[15px] font-semibold tracking-[-.02em]">
              Expenses <span className="text-xs font-normal text-muted-foreground">({totalRows})</span>
            </h4>
            <ul className="space-y-1" data-testid="list-money-expenses">
              {rows.map((row) => (
                <li key={row.expenseId} className="flex items-center gap-3 border-b border-border/50 py-2.5 last:border-0">
                  <TrendingUp
                    size={15}
                    strokeWidth={1.8}
                    className={row.settlementStatus === 'settled' ? 'text-muted-foreground' : 'text-primary'}
                  />
                  <Link href={`/expenses/${row.expenseId}`} className="min-w-0 flex-1" data-testid={`link-money-expense-${row.expenseId}`}>
                    <span className="block truncate text-sm font-semibold">
                      {row.description?.trim() || row.category?.name || 'Expense'}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {row.counterparty} · {row.location.name} · {shortDay(row.date)}
                      {Number(row.trackedAmount) !== Number(row.amount) && (
                        <> · {money(row.amount, row.currency)} expense</>
                      )}
                    </span>
                  </Link>
                  <span
                    className="whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                    data-testid={`text-money-status-${row.expenseId}`}
                  >
                    {row.settlementStatus === 'settled'
                      ? direction === 'owed_to_me'
                        ? 'Paid back'
                        : 'Received'
                      : 'Pending'}
                  </span>
                  <span className="font-display text-sm font-semibold tabular-nums">
                    {money(row.trackedAmount ?? row.amount, row.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function shortDay(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(`${value}T12:00:00`),
  );
}