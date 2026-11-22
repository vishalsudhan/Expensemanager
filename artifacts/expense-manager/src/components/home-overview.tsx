import { Link } from 'wouter';
import { ArrowRight, MapPin } from 'lucide-react';
import { getGetReportOverviewQueryKey, useGetReportOverview } from '@workspace/api-client-react';
import type { GetReportOverviewParams } from '@workspace/api-client-react';
import { localToday } from '@/lib/settlements';
import { ChangeBadge, change, perDay, shareOf } from '@/components/country-insights';
import { Skeleton } from '@/components/ui/skeleton';
import { Amounts } from '@/components/amounts';

/** This calendar month so far, in local time. Shared so both cards use one request. */
function thisMonth(): GetReportOverviewParams {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  return { from, to: localToday(), includeReimbursable: false };
}

function useThisMonth() {
  const params = thisMonth();
  return useGetReportOverview(params, { query: { queryKey: getGetReportOverviewQueryKey(params) } });
}

/** One card per country for this month: own cost, per day, change vs the days before. */
export function CountryMonthCards() {
  const query = useThisMonth();
  const data = query.data;

  if (query.isLoading) {
    return <div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-36 rounded-[22px]" /><Skeleton className="h-36 rounded-[22px]" /></div>;
  }
  if (!data || data.countries.length === 0) {
    return (
      <section className="rounded-[22px] border border-dashed border-border bg-card/55 px-5 py-6 text-center text-sm text-muted-foreground" data-testid="status-home-month-empty">
        Nothing spent yet this month.
      </section>
    );
  }

  return (
    <div className={`grid gap-3 ${data.countries.length > 1 ? 'grid-cols-2' : ''}`} data-testid="section-home-countries">
      {data.countries.map((country) => {
        const delta = change(country.totals, country.previousTotals);
        return (
          <Link
            key={country.location.id}
            href={`/reports?locationId=${country.location.id}`}
            className="group min-w-0 rounded-[22px] border border-border/70 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/25 sm:p-5"
            data-testid={`card-home-country-${country.location.slug}`}
          >
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
              <MapPin size={12} className="text-primary" /> {country.location.name} · this month
            </p>
            <div className="mt-2.5 overflow-hidden font-display text-[20px] font-semibold leading-tight tracking-[-.04em] tabular-nums sm:text-[28px]">
              <Amounts totals={country.totals} testId={`text-home-country-total-${country.location.slug}`} />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{perDay(country.averagePerDay)} a day</p>
            {delta && !delta.isNew && country.previousTotals.length > 0 && (
              <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                <ChangeBadge current={country.totals} previous={country.previousTotals} show /> vs previous {data.range.days} days
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** The top categories of the country with the most spending this month. */
export function TopCategoriesCard() {
  const query = useThisMonth();
  const data = query.data;
  if (!data?.location || data.categories.length === 0) return null;
  const top = data.categories.slice(0, 4);
  const more = data.categories.length - top.length;

  return (
    <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-home-top-categories">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[17px] font-semibold tracking-[-.03em]">Top categories · {data.location.name}</h2>
        <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">This month</span>
      </div>
      <ul className="mt-4 space-y-3">
        {top.map((row) => {
          const share = shareOf(row.totals);
          const params = new URLSearchParams({ locationId: data.location!.id, from: data.range.from, to: data.range.to, parentCategoryId: row.category.id, ownCostOnly: 'true' });
          return (
            <li key={row.category.id}>
              <Link href={`/expenses?${params}`} className="block" data-testid={`link-home-category-${row.category.slug}`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-[96px] flex-1 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.category.color }} />
                    <span className="truncate text-[13px] font-semibold">{row.category.name}</span>
                  </span>
                  <span className="flex shrink-0 items-start gap-1.5">
                    <Amounts totals={row.totals} className="items-end text-[13px] font-semibold tabular-nums" />
                    <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(share * 100)}%</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary/70">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, 1.5)}%`, backgroundColor: row.category.color }} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link href={`/reports?locationId=${data.location.id}`} className="mt-4 inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:underline" data-testid="link-home-full-analysis">
        {more > 0 ? `${more} more · ` : ''}Full analysis in Reports <ArrowRight size={13} />
      </Link>
    </section>
  );
}
