import { useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import {
  getGetReportTrendsQueryKey, useGetReportTrends,
} from '@workspace/api-client-react';
import type { ReportTrends } from '@workspace/api-client-react';
import { errorText, formatTotals, money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export type TrendGroupBy = 'category' | 'project' | 'label' | 'location' | 'transactionType';
type Granularity = 'day' | 'week' | 'month';

const GROUP_OPTIONS: { key: TrendGroupBy; label: string }[] = [
  { key: 'category', label: 'Category' },
  { key: 'project', label: 'Project' },
  { key: 'label', label: 'Label' },
  { key: 'location', label: 'Location' },
  { key: 'transactionType', label: 'Type' },
];

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

/**
 * Distinguishable hues. The palette deliberately avoids the entity colours,
 * which belong to the breakdown cards, so a series here is never mistaken for
 * its colour in a list elsewhere.
 */
const PALETTE = [
  '#2F6F62', '#B26A3F', '#4A6FA5', '#8B5E83', '#6E7F35',
  '#A34A4A', '#3F7F8C', '#7A6A4F', '#5B5BD6', '#2E8B57',
  '#B8860B', '#5A6B8C', '#9C4A6B', '#3F7A5C', '#8A6D3B',
];

const colourFor = (index: number) => PALETTE[index % PALETTE.length];

/**
 * Two series in one stack must never share a colour, or the stack is
 * unreadable. Category, project and label colours are free to repeat and often
 * do (a seeded palette is not required to be distinct), so a stacked chart
 * always draws from this palette instead and uses the entity colour only as
 * the small accent beside the series name.
 */

/**
 * How many series can be on at once. More than this and the chart stops being
 * readable, so the rest are listed but switched off until asked for.
 */
const MAX_ENABLED = 6;

const fieldClass =
  'h-9 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

type Row = {
  key: string;
  name: string;
  colour: string;
  entityColour: string | null;
  byBucket: Map<string, number>;
  total: number;
};

export function TrendsChart({
  from, to, locationId, transactionType, fallbackMonths = 6,
}: {
  from: string; to: string; locationId?: string;
  transactionType: 'total' | 'expense' | 'payment'; fallbackMonths?: number;
}) {
  const [groupBy, setGroupBy] = useState<TrendGroupBy>('category');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(new Set());
  const [currencyId, setCurrencyId] = useState('');

  const params = {
    from, to, groupBy, granularity, transactionType,
    ...(locationId ? { locationId } : {}),
  };
  const query = useGetReportTrends(params, {
    query: { queryKey: getGetReportTrendsQueryKey(params), placeholderData: keepPreviousData },
  });
  const trends: ReportTrends | undefined = query.data;

  // Currencies are never combined, so the reader picks one and only that one is
  // charted. Everything below is scoped to the selected currency.
  const currencies = useMemo(() => {
    const map = new Map<string, { id: string; code: string; symbol: string; decimalPlaces: number }>();
    for (const series of trends?.series ?? []) {
      for (const entry of series.totals) {
        if (!map.has(entry.currency.id)) {
          map.set(entry.currency.id, {
            id: entry.currency.id,
            code: entry.currency.code,
            symbol: entry.currency.symbol,
            decimalPlaces: entry.currency.decimalPlaces,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [trends]);

  const activeCurrencyId = currencyId || currencies[0]?.id || '';
  const activeCurrency = currencies.find((c) => c.id === activeCurrencyId);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    let index = 0;
    for (const series of trends?.series ?? []) {
      const entry = series.totals.find((t) => t.currency.id === activeCurrencyId);
      const byBucket = new Map<string, number>();
      for (const bucket of trends?.buckets ?? []) {
        const point = bucket.points.find(
          (p) => p.seriesKey === series.key && p.currency.id === activeCurrencyId,
        );
        byBucket.set(bucket.key, point ? Number(point.total) : 0);
      }
      out.push({
        key: series.key,
        name: series.name,
        entityColour: series.color,
        colour: colourFor(index),
        byBucket,
        total: entry ? Number(entry.total) : 0,
      });
      index += 1;
    }
    return out.filter((row) => row.total > 0).sort((a, b) => b.total - a.total);
  }, [trends, activeCurrencyId]);

  // Default to the biggest few on, but let the reader turn anything on or off.
  const defaultEnabled = useMemo(
    () => new Set(rows.slice(0, MAX_ENABLED).map((row) => row.key)),
    [rows],
  );
  const isDefaulting = enabled.size === 0;
  const on = isDefaulting ? defaultEnabled : enabled;

  const toggle = (key: string) => {
    const base = new Set(isDefaulting ? defaultEnabled : enabled);
    if (base.has(key)) base.delete(key);
    else base.add(key);
    setEnabled(base);
  };

  const setAll = (keys: string[]) => setEnabled(new Set(keys));

  const shown = rows.filter((row) => on.has(row.key));
  const buckets = trends?.buckets ?? [];
  const peak = buckets.reduce(
    (max, bucket) => Math.max(max, ...shown.map((row) => row.byBucket.get(bucket.key) ?? 0)),
    0,
  );
  const grandTotal = rows.reduce((sum, row) => sum + (on.has(row.key) ? row.total : 0), 0);

  const label = granularity === 'month' ? 'Month' : granularity === 'week' ? 'Week' : 'Day';
  // Every bucket key is already a full YYYY-MM-DD date, including month buckets,
  // which the API keys to the first of the month.
  const tickLabel = (key: string) => {
    const date = new Date(`${key}T12:00:00`);
    if (Number.isNaN(date.getTime())) return key;
    return granularity === 'month'
      ? new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' }).format(date)
      : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  };

  return (
    <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-report-trends">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-[17px] font-semibold tracking-[-0.03em]">Spending over time</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            One chart for the whole range. Switch series on and off to compare.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-secondary/65 p-1" role="group" aria-label="Group chart by" data-testid="group-trends-groupby">
            {GROUP_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={groupBy === option.key}
                onClick={() => { setGroupBy(option.key); setEnabled(new Set()); }}
                className={`min-h-8 rounded-lg px-3 text-[11px] font-bold transition-colors ${groupBy === option.key ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                data-testid={`button-trends-group-${option.key}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <select
            value={granularity}
            onChange={(event) => setGranularity(event.target.value as Granularity)}
            aria-label="Chart bucket size"
            className={fieldClass}
            data-testid="select-trends-granularity"
          >
            {GRANULARITIES.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
          {currencies.length > 1 && (
            <select
              value={activeCurrencyId}
              onChange={(event) => setCurrencyId(event.target.value)}
              aria-label="Currency to chart"
              className={fieldClass}
              data-testid="select-trends-currency"
            >
              {currencies.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.code}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {query.isLoading ? (
        <div className="mt-5 space-y-3" data-testid="status-trends-loading">
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      ) : query.isError ? (
        <div className="mt-5 rounded-[16px] border border-destructive/25 bg-background px-4 py-6 text-center" data-testid="status-trends-error">
          <p className="text-sm text-muted-foreground">{errorText(query.error)}</p>
          <Button onClick={() => query.refetch()} variant="outline" className="mt-4 gap-2" data-testid="button-retry-trends">
            Try again
          </Button>
        </div>
      ) : !rows.length ? (
        <div className="mt-5 rounded-[16px] border border-dashed border-border bg-background/60 px-4 py-10 text-center" data-testid="status-trends-empty">
          <p className="text-sm text-muted-foreground">Nothing recorded in this range.</p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground" data-testid="text-trends-shown-total">
                {money(grandTotal, {
                  id: activeCurrencyId,
                  code: activeCurrency?.code ?? '',
                  name: activeCurrency?.code ?? '',
                  symbol: activeCurrency?.symbol ?? '',
                  decimalPlaces: activeCurrency?.decimalPlaces ?? 2,
                  isActive: true,
                })}
              </span>
              {' across '}
              <span data-testid="text-trends-shown-count">{shown.length}</span>
              {' of '}
              <span data-testid="text-trends-total-count">{rows.length}</span>
              {' series'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAll(rows.map((row) => row.key))}
                className="text-[11px] font-bold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                data-testid="button-trends-enable-all"
              >
                Show all
              </button>
              <button
                type="button"
                onClick={() => setAll(rows.slice(0, MAX_ENABLED).map((row) => row.key))}
                className="text-[11px] font-bold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                data-testid="button-trends-enable-top"
              >
                Top {MAX_ENABLED}
              </button>
            </div>
          </div>

          {/* One stacked column per bucket. Stacking only ever adds figures
              already in the chosen currency. */}
          <div className="mt-4" data-testid="chart-trends">
            <div className="flex h-52 items-end gap-px sm:gap-[2px]" role="img" aria-label={`Spending by ${label.toLowerCase()} across ${shown.length} series`}>
              {buckets.map((bucket) => {
                const stack = shown
                  .map((row) => ({ row, value: row.byBucket.get(bucket.key) ?? 0 }))
                  .filter((entry) => entry.value > 0);
                const stackTotal = stack.reduce((sum, entry) => sum + entry.value, 0);
                return (
                  <div key={bucket.key} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-px" title={`${tickLabel(bucket.key)} · ${money(stackTotal, { id: activeCurrencyId, code: activeCurrency?.code ?? '', name: '', symbol: activeCurrency?.symbol ?? '', decimalPlaces: 2, isActive: true })}`}>
                    {stack.map((entry) => {
                      const height = peak > 0 ? Math.max((entry.value / peak) * 100, 2) : 0;
                      return (
                        <div
                          key={entry.row.key}
                          className="w-full transition-opacity"
                          style={{ height: `${height}%`, backgroundColor: entry.row.colour }}
                          data-testid={`bar-trends-${entry.row.key}`}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-px border-t border-border/60 pt-1 sm:gap-[2px]">
              {buckets.map((bucket) => (
                <div key={bucket.key} className="min-w-0 flex-1 truncate text-center text-[9px] text-muted-foreground">
                  {buckets.length <= 8 || bucket.key.endsWith('-01') || granularity === 'month'
                    ? tickLabel(bucket.key)
                    : ''}
                </div>
              ))}
            </div>
          </div>

          {/* The switchboard: every series the range contains, whatever is on. */}
          <div className="mt-5 border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">
                Series
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {shown.length} of {rows.length} shown
              </span>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="list-trends-series">
              {rows.map((row) => {
                const isOn = on.has(row.key);
                return (
                  <li key={row.key}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isOn}
                      onClick={() => toggle(row.key)}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${isOn ? 'border-transparent bg-secondary text-foreground' : 'border-border/70 text-muted-foreground hover:text-foreground'}`}
                      data-testid={`toggle-trends-series-${row.key}`}
                      data-state={isOn ? 'on' : 'off'}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: isOn ? row.colour : 'transparent',
                          border: isOn ? 'none' : `1.5px solid ${row.colour}`,
                        }}
                        aria-hidden="true"
                      />
                      {row.entityColour && (
                        <span
                          className="size-2 shrink-0 rounded-full ring-1 ring-border"
                          style={{ backgroundColor: row.entityColour }}
                          title="This record's own colour"
                          aria-hidden="true"
                        />
                      )}
                      <span className="max-w-[160px] truncate">{row.name}</span>
                      <span className="tabular-nums opacity-70">
                        {money(row.total, { id: activeCurrencyId, code: activeCurrency?.code ?? '', name: '', symbol: activeCurrency?.symbol ?? '', decimalPlaces: activeCurrency?.decimalPlaces ?? 2, isActive: true })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}