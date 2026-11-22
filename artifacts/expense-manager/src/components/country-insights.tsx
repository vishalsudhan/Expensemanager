import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, CircleAlert, Globe2, RotateCcw } from 'lucide-react';
import {
  getGetCountryCategoryReportQueryKey,
  useGetCountryCategoryReport,
} from '@workspace/api-client-react';
import type {
  CountryCategoryRow,
  CurrencyAmount,
  CurrencyAverage,
  GetCountryCategoryReportParams,
} from '@workspace/api-client-react';
import { errorText, formatDate, formatShortDate, formatTotals, money } from '@/lib/format';
import { localToday } from '@/lib/settlements';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Amounts } from '@/components/amounts';
import { Switch } from '@/components/ui/switch';

type Preset = 'this_month' | 'last_month' | 'last_3_months' | 'this_year' | 'all' | 'custom';

const presets: { value: Preset; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_3_months', label: 'Last 3 months' },
  { value: 'this_year', label: 'This year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

const STORAGE_KEY = 'pocketful-insights';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Local calendar ranges, so "this month" is this month in Doha, not in UTC. */
function presetRange(preset: Exclude<Preset, 'custom'>): { from?: string; to?: string } {
  const now = new Date();
  const today = localToday();
  switch (preset) {
    case 'this_month':
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'last_month':
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'last_3_months':
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: today };
    case 'this_year':
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: today };
    case 'all':
      return {};
  }
}

function loadSaved(): { preset: Preset; from: string; to: string; includeReimbursable: boolean } {
  const fallback = { preset: 'last_3_months' as Preset, from: '', to: '', includeReimbursable: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    return {
      preset: presets.some((p) => p.value === saved.preset) ? saved.preset : fallback.preset,
      from: typeof saved.from === 'string' ? saved.from : '',
      to: typeof saved.to === 'string' ? saved.to : '',
      includeReimbursable: saved.includeReimbursable === true,
    };
  } catch {
    return fallback;
  }
}

/** Percentage change per currency; null when there is nothing to compare with. */
export function change(current: CurrencyAmount[], previous: CurrencyAmount[]): { pct: number | null; isNew: boolean } | null {
  if (current.length !== 1) return null; // Never compare across currencies.
  const now = Number(current[0].total);
  const before = Number(previous.find((p) => p.currency.id === current[0].currency.id)?.total ?? 0);
  if (before <= 0) return { pct: null, isNew: true };
  return { pct: Math.round(((now - before) / before) * 100), isNew: false };
}

export function ChangeBadge({ current, previous, show }: { current: CurrencyAmount[]; previous: CurrencyAmount[]; show: boolean }) {
  if (!show) return null;
  const delta = change(current, previous);
  if (!delta) return null;
  if (delta.isNew) {
    return <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">New</span>;
  }
  if (delta.pct === 0) {
    return <span className="text-[10px] font-bold text-muted-foreground">±0%</span>;
  }
  const up = (delta.pct ?? 0) > 0;
  // More spending is the thing to notice, so up is amber and down is green.
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums ${up ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
      {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {Math.abs(delta.pct ?? 0)}%
    </span>
  );
}

export const perDay = (averages: CurrencyAverage[]) =>
  averages.map((entry) => money(entry.amount, entry.currency)).join(' · ');

export const shareOf = (totals: CurrencyAmount[]) => Math.max(0, ...totals.map((entry) => entry.share ?? 0));

export function CategoryRow({
  row, locationId, range, includeReimbursable, showChange, expanded, onToggle,
}: {
  row: CountryCategoryRow;
  locationId: string;
  range: { from: string; to: string };
  includeReimbursable: boolean;
  showChange: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const share = shareOf(row.totals);
  const filter = (categoryParam: string) => {
    const params = new URLSearchParams({ locationId, from: range.from, to: range.to });
    const [key, value] = categoryParam.split('=');
    params.set(key, value);
    if (!includeReimbursable) params.set('ownCostOnly', 'true');
    return `/expenses?${params.toString()}`;
  };
  const hasChildren = row.children.length > 0;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-[96px] flex-1 items-center gap-2">
          {hasChildren ? (
            expanded ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.category.color }} />
          <span className="truncate text-[14px] font-semibold">{row.category.name}</span>
          <ChangeBadge current={row.totals} previous={row.previousTotals} show={showChange} />
        </div>
        <div className="flex shrink-0 items-start gap-1.5 text-right">
          <Amounts totals={row.totals} className="items-end text-[13px] font-semibold tabular-nums" />
          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{Math.round(share * 100)}%</span>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary/70">
        <div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, 1.5)}%`, backgroundColor: row.category.color }} />
      </div>
      <p className="mt-1.5 pl-5 text-[11px] text-muted-foreground">{perDay(row.averagePerDay)} a day</p>
    </>
  );

  return (
    <li className="border-t border-border/60 first:border-t-0" data-testid={`row-insight-category-${row.category.slug}`}>
      {hasChildren ? (
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="block w-full py-3 text-left" data-testid={`button-insight-expand-${row.category.slug}`}>
          {header}
        </button>
      ) : (
        <Link href={filter(`parentCategoryId=${row.category.id}`)} className="block py-3" data-testid={`link-insight-category-${row.category.slug}`}>
          {header}
        </Link>
      )}
      {expanded && hasChildren && (
        <ul className="mb-3 ml-[7px] space-y-0.5 border-l-2 border-border/70 pl-4" data-testid={`list-insight-children-${row.category.slug}`}>
          {row.children.map((child) => (
            <li key={child.category.id}>
              <Link
                href={filter(`categoryId=${child.category.id}`)}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/50"
                data-testid={`link-insight-subcategory-${child.category.slug}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px]">{child.category.name}</span>
                  <ChangeBadge current={child.totals} previous={child.previousTotals} show={showChange} />
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[13px] font-semibold tabular-nums">{formatTotals(child.totals)}</span>
                  <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(shareOf(child.totals) * 100)}%</span>
                  <ChevronRight size={13} className="text-muted-foreground/60" />
                </span>
              </Link>
            </li>
          ))}
          <li>
            <Link href={filter(`parentCategoryId=${row.category.id}`)} className="inline-flex px-2 py-1.5 text-[11px] font-bold text-primary hover:underline">
              All {row.category.name} expenses
            </Link>
          </li>
        </ul>
      )}
    </li>
  );
}

/** Home section: where the money goes, per country, by category, for any range. */
export function CountryInsights() {
  const saved = useMemo(loadSaved, []);
  const [preset, setPreset] = useState<Preset>(saved.preset);
  const [customFrom, setCustomFrom] = useState(saved.from);
  const [customTo, setCustomTo] = useState(saved.to || localToday());
  const [includeReimbursable, setIncludeReimbursable] = useState(saved.includeReimbursable);
  const [countryId, setCountryId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ preset, from: customFrom, to: customTo, includeReimbursable }),
      );
    } catch {
      // Storage is a convenience; private browsing can refuse it.
    }
  }, [preset, customFrom, customTo, includeReimbursable]);

  const customValid = DATE.test(customFrom) && DATE.test(customTo) && customFrom <= customTo;
  const range = preset === 'custom' ? (customValid ? { from: customFrom, to: customTo } : null) : presetRange(preset);
  const params: GetCountryCategoryReportParams = { ...(range ?? {}), includeReimbursable };
  const query = useGetCountryCategoryReport(params, {
    query: {
      queryKey: getGetCountryCategoryReportQueryKey(params),
      enabled: range !== null,
      placeholderData: keepPreviousData,
    },
  });
  const report = query.data;
  const countries = report?.countries ?? [];
  const country = countries.find((entry) => entry.location.id === countryId) ?? countries[0];
  // Comparing only makes sense when the earlier period had spending here;
  // otherwise every row would just say "New".
  const showChange = report?.previousRange != null && (country?.previousTotals.length ?? 0) > 0;

  return (
    <section className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-7" data-testid="section-country-insights">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Globe2 size={17} /></span>
        <div className="min-w-0">
          <h2 className="font-display text-[19px] font-semibold tracking-[-.03em]">Where your money goes</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">By country and category. Tap a category for its breakdown.</p>
        </div>
      </div>

      <div className="-mx-1 mt-5 overflow-x-auto px-1 pb-1">
        <div className="flex w-max gap-1.5" role="group" aria-label="Time range">
          {presets.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={preset === option.value}
              onClick={() => setPreset(option.value)}
              className={`min-h-9 whitespace-nowrap rounded-full border px-3.5 text-xs font-semibold transition-colors ${
                preset === option.value ? 'border-primary/40 bg-secondary text-primary' : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              data-testid={`button-insight-range-${option.value}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {preset === 'custom' && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">From</span>
            <Input type="date" value={customFrom} max={customTo || localToday()} onChange={(e) => setCustomFrom(e.target.value)} className="h-10 rounded-xl bg-background" data-testid="input-insight-from" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">To</span>
            <Input type="date" value={customTo} min={customFrom || undefined} max={localToday()} onChange={(e) => setCustomTo(e.target.value)} className="h-10 rounded-xl bg-background" data-testid="input-insight-to" />
          </label>
          {!customValid && <p className="col-span-2 text-[11px] text-muted-foreground" data-testid="text-insight-custom-hint">Choose a start and end date.</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Country">
          {countries.map((entry) => {
            const active = entry.location.id === country?.location.id;
            return (
              <button
                key={entry.location.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCountryId(entry.location.id)}
                className={`min-h-9 rounded-xl px-3.5 text-[13px] font-semibold transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:text-foreground'}`}
                data-testid={`tab-insight-country-${entry.location.slug}`}
              >
                {entry.location.name}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
          <Switch checked={includeReimbursable} onCheckedChange={setIncludeReimbursable} data-testid="switch-insight-reimbursable" />
          Include reimbursable
        </label>
      </div>

      {range === null ? null : query.isLoading ? (
        <div className="mt-5 space-y-3" data-testid="status-insights-loading">
          <Skeleton className="h-10 w-48" />
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      ) : query.isError ? (
        <div className="mt-5 rounded-2xl border border-destructive/25 px-4 py-5 text-center" data-testid="status-insights-error">
          <CircleAlert size={18} className="mx-auto text-destructive" />
          <p className="mt-2 text-sm text-muted-foreground">{errorText(query.error)}</p>
          <Button variant="outline" onClick={() => query.refetch()} className="mt-3 h-9 gap-2 rounded-xl text-xs"><RotateCcw size={13} /> Try again</Button>
        </div>
      ) : !country || !report ? (
        <p className="mt-5 rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground" data-testid="status-insights-empty">
          No spending in this range. Try a longer one.
        </p>
      ) : (
        <div className={query.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          <div className="mt-5 grid grid-cols-2 gap-3" data-testid="summary-insight-country">
            <div className="rounded-2xl border border-border/60 bg-secondary/35 px-4 py-3.5">
              <p className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Spent{includeReimbursable ? '' : ' · own cost'}</p>
              <p className="mt-1.5 font-display text-[22px] font-semibold leading-tight tracking-[-.035em] tabular-nums" data-testid="text-insight-total">{formatTotals(country.totals)}</p>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ChangeBadge current={country.totals} previous={country.previousTotals} show={showChange} />
                {showChange && change(country.totals, country.previousTotals) && <span>vs previous {report.range.days} days</span>}
              </div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-secondary/35 px-4 py-3.5">
              <p className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Average per day</p>
              <p className="mt-1.5 font-display text-[22px] font-semibold leading-tight tracking-[-.035em] tabular-nums" data-testid="text-insight-per-day">{perDay(country.averagePerDay) || '—'}</p>
              <p className="mt-1 text-[11px] text-muted-foreground" data-testid="text-insight-range">
                {formatShortDate(report.range.from)} – {formatDate(report.range.to)} · {report.range.days} {report.range.days === 1 ? 'day' : 'days'}
              </p>
            </div>
          </div>

          <ul className="mt-4" data-testid="list-insight-categories">
            {country.categories.map((row) => {
              const key = `${country.location.id}:${row.category.id}`;
              return (
                <CategoryRow
                  key={row.category.id}
                  row={row}
                  locationId={country.location.id}
                  range={report.range}
                  includeReimbursable={includeReimbursable}
                  showChange={showChange}
                  expanded={Boolean(expanded[key])}
                  onToggle={() => setExpanded((current) => ({ ...current, [key]: !current[key] }))}
                />
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
