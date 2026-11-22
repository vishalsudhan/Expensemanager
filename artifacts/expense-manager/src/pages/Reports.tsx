import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { Link, useSearch } from 'wouter';
import {
  ArrowRight, ChevronLeft, ChevronRight, CircleAlert, Hash, Layers3, ReceiptText, RotateCcw, Wallet,
} from 'lucide-react';
import { getGetReportOverviewQueryKey, useGetReportOverview } from '@workspace/api-client-react';
import type {
  CurrencyAmount, GetReportOverviewParams, OverviewBucket, ReportOverview,
} from '@workspace/api-client-react';
import { errorText, formatDate, formatShortDate, money } from '@/lib/format';
import { localToday } from '@/lib/settlements';
import { CategoryRow, ChangeBadge, change, shareOf } from '@/components/country-insights';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Amounts } from '@/components/amounts';
import { Switch } from '@/components/ui/switch';

type Mode = 'week' | 'month' | 'quarter' | 'year' | 'custom' | 'all';

const modes: { value: Mode; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: '3 months' },
  { value: 'year', label: 'Year' },
  { value: 'custom', label: 'Custom' },
  { value: 'all', label: 'All time' },
];

const STORAGE_KEY = 'pocketful-reports';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
const minDate = (a: string, b: string) => (a < b ? a : b);

/** Calendar ranges in local time, never running past today. */
function rangeFor(mode: Mode, anchor: string): { from: string; to: string } | null {
  const a = parse(anchor);
  const today = localToday();
  switch (mode) {
    case 'week': {
      const monday = new Date(a.getFullYear(), a.getMonth(), a.getDate() - ((a.getDay() + 6) % 7), 12);
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 12);
      return { from: iso(monday), to: minDate(iso(sunday), today) };
    }
    case 'month':
      return { from: iso(new Date(a.getFullYear(), a.getMonth(), 1)), to: minDate(iso(new Date(a.getFullYear(), a.getMonth() + 1, 0)), today) };
    case 'quarter':
      return { from: iso(new Date(a.getFullYear(), a.getMonth() - 2, 1)), to: minDate(iso(new Date(a.getFullYear(), a.getMonth() + 1, 0)), today) };
    case 'year':
      return { from: `${a.getFullYear()}-01-01`, to: minDate(`${a.getFullYear()}-12-31`, today) };
    default:
      return null;
  }
}

function step(mode: Mode, anchor: string, direction: 1 | -1): string {
  const a = parse(anchor);
  if (mode === 'week') return iso(new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * direction, 12));
  if (mode === 'month') return iso(new Date(a.getFullYear(), a.getMonth() + direction, 1, 12));
  if (mode === 'quarter') return iso(new Date(a.getFullYear(), a.getMonth() + 3 * direction, 1, 12));
  return iso(new Date(a.getFullYear() + direction, 0, 1, 12));
}

function periodLabel(mode: Mode, range: { from: string; to: string }): string {
  const from = parse(range.from);
  const month = (d: Date, year = true) => new Intl.DateTimeFormat(undefined, { month: year ? 'long' : 'short', ...(year ? { year: 'numeric' } : {}) }).format(d);
  if (mode === 'month') return month(from);
  if (mode === 'year') return String(from.getFullYear());
  if (mode === 'quarter') {
    const end = new Date(from.getFullYear(), from.getMonth() + 2, 1, 12);
    return `${month(from, false)} – ${month(end, false)} ${end.getFullYear()}`;
  }
  return `${formatShortDate(range.from)} – ${formatDate(range.to)}`;
}

function loadSaved() {
  const fallback = { mode: 'month' as Mode, anchor: localToday(), from: '', to: '', locationId: '', includeReimbursable: false };
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!saved) return fallback;
    return {
      mode: modes.some((m) => m.value === saved.mode) ? (saved.mode as Mode) : fallback.mode,
      // Each visit starts on the current period; the kind of period is remembered.
      anchor: localToday(),
      from: typeof saved.from === 'string' ? saved.from : '',
      to: typeof saved.to === 'string' ? saved.to : '',
      locationId: typeof saved.locationId === 'string' ? saved.locationId : '',
      includeReimbursable: saved.includeReimbursable === true,
    };
  } catch {
    return fallback;
  }
}

const paymentLabels: Record<string, string> = {
  cash: 'Cash', credit_card: 'Credit card', debit_card: 'Debit card', bank_transfer: 'Bank transfer', upi: 'UPI', other: 'Other',
};

/** The currency a country mostly spends in, for the bar chart. */
function mainCurrency(totals: CurrencyAmount[]): string | null {
  if (!totals.length) return null;
  return [...totals].sort((a, b) => b.count - a.count)[0].currency.id;
}

function bucketEnd(start: string, granularity: 'day' | 'week' | 'month', rangeTo: string): string {
  const d = parse(start);
  const end =
    granularity === 'day' ? d
      : granularity === 'week' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6, 12)
        : new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
  return minDate(iso(end), rangeTo);
}

function bucketLabel(start: string, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'month') return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(parse(start));
  return formatShortDate(start);
}

function Kpi({ label, value, hint, testId, wide = false }: { label: string; value: React.ReactNode; hint?: React.ReactNode; testId: string; wide?: boolean }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-border/60 bg-card px-4 py-3.5 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
      <p className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">{label}</p>
      <div className={`mt-1.5 font-display font-semibold leading-tight tracking-[-.03em] tabular-nums ${wide ? 'text-[26px] sm:text-[24px]' : 'text-[18px] sm:text-[22px]'}`} data-testid={testId}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Timeline({ data, expensesBase }: { data: ReportOverview; expensesBase: URLSearchParams }) {
  const currencies = data.totals.map((t) => t.currency);
  const [currencyId, setCurrencyId] = useState<string | null>(null);
  const active = currencyId && currencies.some((c) => c.id === currencyId) ? currencyId : mainCurrency(data.totals);
  const currency = currencies.find((c) => c.id === active) ?? null;
  const values = data.timeline.buckets.map((bucket: OverviewBucket) =>
    Number(bucket.totals.find((t) => t.currency.id === active)?.total ?? 0),
  );
  const peak = Math.max(...values, 0);
  const { granularity, buckets } = data.timeline;
  const unit = granularity === 'day' ? 'Daily' : granularity === 'week' ? 'Weekly' : 'Monthly';
  const labelAt = new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]);

  return (
    <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-report-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">Spending over time</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{unit} · tap a bar to see those expenses</p>
        </div>
        {currencies.length > 1 && (
          <div className="flex gap-1" role="group" aria-label="Currency">
            {currencies.map((c) => (
              <button key={c.id} type="button" onClick={() => setCurrencyId(c.id)} aria-pressed={c.id === active} className={`min-h-8 rounded-lg px-2.5 text-[11px] font-bold ${c.id === active ? 'bg-secondary text-primary' : 'text-muted-foreground'}`}>{c.code}</button>
            ))}
          </div>
        )}
      </div>
      {peak === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Nothing spent in this period.</p>
      ) : (
        <>
          <div className="mt-5 flex h-40 items-end gap-[3px]" data-testid="chart-report-timeline">
            {buckets.map((bucket, index) => {
              const value = values[index];
              const params = new URLSearchParams(expensesBase);
              params.set('from', bucket.start);
              params.set('to', bucketEnd(bucket.start, granularity, data.range.to));
              const label = `${bucketLabel(bucket.start, granularity)}: ${currency ? money(value, currency) : value}`;
              return (
                <Link
                  key={bucket.start}
                  href={`/expenses?${params.toString()}`}
                  title={label}
                  aria-label={label}
                  className="group flex h-full min-w-0 flex-1 items-end"
                  data-testid={`bar-report-${bucket.start}`}
                >
                  <span
                    className={`block w-full rounded-t-[4px] transition-colors ${value > 0 ? 'bg-primary/75 group-hover:bg-primary' : 'bg-secondary/60'}`}
                    style={{ height: value > 0 ? `${Math.max((value / peak) * 100, 3)}%` : '2px' }}
                  />
                </Link>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            {buckets.map((bucket, index) => (labelAt.has(index) ? <span key={bucket.start}>{bucketLabel(bucket.start, granularity)}</span> : null))}
          </div>
          {currency && <p className="mt-3 text-[11px] text-muted-foreground">Highest {granularity}: <span className="font-semibold text-foreground">{money(peak, currency)}</span></p>}
        </>
      )}
    </section>
  );
}

type BreakdownTab = 'projects' | 'labels' | 'methods';

function Breakdowns({ data, expensesBase }: { data: ReportOverview; expensesBase: URLSearchParams }) {
  const [tab, setTab] = useState<BreakdownTab>('projects');
  const rows: { key: string; name: string; color?: string; totals: CurrencyAmount[]; href: string | null }[] =
    tab === 'projects'
      ? data.projects.map((row) => {
          const params = new URLSearchParams(expensesBase);
          if (row.project) params.set('projectId', row.project.id);
          return { key: row.project?.id ?? 'none', name: row.project?.name ?? 'No project', color: row.project?.color, totals: row.totals, href: row.project ? `/expenses?${params}` : null };
        })
      : tab === 'labels'
        ? data.labels.map((row) => {
            const params = new URLSearchParams(expensesBase);
            params.set('labelId', row.label.id);
            return { key: row.label.id, name: row.label.name, color: row.label.color, totals: row.totals, href: `/expenses?${params}` };
          })
        : data.paymentMethods.map((row) => {
            const params = new URLSearchParams(expensesBase);
            if (row.method) params.set('paymentMethod', row.method);
            return { key: row.method ?? 'none', name: row.method ? paymentLabels[row.method] ?? row.method : 'Not specified', totals: row.totals, href: row.method ? `/expenses?${params}` : null };
          });
  const tabs: { key: BreakdownTab; label: string }[] = [
    { key: 'projects', label: 'Projects' },
    { key: 'labels', label: 'Labels' },
    { key: 'methods', label: 'Payment method' },
  ];

  return (
    <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-report-breakdowns">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">More breakdowns</h2>
        <div className="inline-flex gap-1 rounded-xl bg-secondary/60 p-1" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`min-h-8 rounded-lg px-3 text-[11px] font-bold ${tab === t.key ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`} data-testid={`tab-report-breakdown-${t.key}`}>{t.label}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">{tab === 'labels' ? 'No labels used in this period.' : 'Nothing to show for this period.'}</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {rows.map((row) => {
            const share = shareOf(row.totals);
            const body = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-[96px] flex-1 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full bg-muted-foreground/60" style={row.color ? { backgroundColor: row.color } : undefined} />
                    <span className="truncate text-[13px] font-semibold">{row.name}</span>
                  </span>
                  <span className="flex shrink-0 items-start gap-1.5">
                    <Amounts totals={row.totals} className="items-end text-[13px] font-semibold tabular-nums" />
                    <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(share * 100)}%</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary/70"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(share * 100, 1.5)}%` }} /></div>
              </>
            );
            return (
              <li key={row.key} data-testid={`row-report-breakdown-${row.key}`}>
                {row.href ? <Link href={row.href} className="block rounded-xl px-2 py-2.5 transition-colors hover:bg-secondary/40">{body}</Link> : <div className="px-2 py-2.5">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ReportsPage() {
  const saved = useMemo(loadSaved, []);
  const search = useSearch();
  const urlLocation = useMemo(() => new URLSearchParams(search).get('locationId') ?? '', [search]);
  const [mode, setMode] = useState<Mode>(saved.mode);
  const [anchor, setAnchor] = useState(saved.anchor);
  const [customFrom, setCustomFrom] = useState(saved.from);
  const [customTo, setCustomTo] = useState(saved.to || localToday());
  const [locationId, setLocationId] = useState(urlLocation || saved.locationId);
  const [includeReimbursable, setIncludeReimbursable] = useState(saved.includeReimbursable);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (urlLocation) setLocationId(urlLocation);
  }, [urlLocation]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, from: customFrom, to: customTo, locationId, includeReimbursable }));
    } catch {
      // A convenience only; private browsing may refuse storage.
    }
  }, [mode, customFrom, customTo, locationId, includeReimbursable]);

  const customValid = DATE.test(customFrom) && DATE.test(customTo) && customFrom <= customTo;
  // All time still ends on today in local time, not the server's (UTC) date.
  const range = mode === 'custom' ? (customValid ? { from: customFrom, to: customTo } : null) : mode === 'all' ? { to: localToday() } : rangeFor(mode, anchor);
  const steppable = mode === 'week' || mode === 'month' || mode === 'quarter' || mode === 'year';
  const nextRange = steppable ? rangeFor(mode, step(mode, anchor, 1)) : null;
  const canGoNext = Boolean(nextRange && nextRange.from <= localToday());

  const params: GetReportOverviewParams = { ...(range ?? {}), ...(locationId ? { locationId } : {}), includeReimbursable };
  const query = useGetReportOverview(params, {
    query: { queryKey: getGetReportOverviewQueryKey(params), enabled: range !== null, placeholderData: keepPreviousData },
  });
  const data = query.data;

  // Chips: every country with spending, plus the chosen one even when it has none.
  const chips = data ? [...data.countries.map((c) => c.location)] : [];
  if (data?.location && !chips.some((l) => l.id === data.location?.id)) chips.push(data.location);

  const expensesBase = new URLSearchParams();
  if (data?.location) expensesBase.set('locationId', data.location.id);
  if (data) {
    expensesBase.set('from', data.range.from);
    expensesBase.set('to', data.range.to);
  }
  if (!includeReimbursable) expensesBase.set('ownCostOnly', 'true');

  const entries = data?.totals.reduce((sum, t) => sum + t.count, 0) ?? 0;
  const showChange = Boolean(data?.previousRange && data.previousTotals.length > 0);

  return (
    <div className="page-enter">
      <p className="mb-7 text-[10px] font-bold uppercase tracking-[.19em] text-primary">YOUR REPORTS</p>
      <header className="border-b border-border/80 pb-7">
        <h1 className="font-display text-[40px] font-semibold leading-none tracking-[-.055em] sm:text-[52px]" data-testid="heading-reports">Reports</h1>
        <p className="mt-3 max-w-[520px] text-[14px] leading-6 text-muted-foreground">Pick a period and a country. Everything below follows, and every number opens the expenses behind it.</p>
      </header>

      <section className="sticky top-[72px] z-[5] -mx-5 mt-6 border-b border-border/70 bg-background/95 px-5 pb-3 pt-3 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12" data-testid="section-report-filters">
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="flex w-max gap-1.5" role="group" aria-label="Period">
            {modes.map((m) => (
              <button key={m.value} type="button" aria-pressed={mode === m.value} onClick={() => { setMode(m.value); setAnchor(localToday()); }} className={`min-h-9 whitespace-nowrap rounded-full border px-3.5 text-xs font-semibold transition-colors ${mode === m.value ? 'border-primary/40 bg-secondary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`} data-testid={`button-report-mode-${m.value}`}>{m.label}</button>
            ))}
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          {steppable && range && 'from' in range ? (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setAnchor(step(mode, anchor, -1))} aria-label="Previous period" className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground hover:text-foreground" data-testid="button-report-prev"><ChevronLeft size={16} /></button>
              <span className="min-w-[132px] px-1 text-center text-[13px] font-semibold" data-testid="text-report-period">{periodLabel(mode, range as { from: string; to: string })}</span>
              <button type="button" onClick={() => setAnchor(step(mode, anchor, 1))} disabled={!canGoNext} aria-label="Next period" className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground hover:text-foreground disabled:opacity-35" data-testid="button-report-next"><ChevronRight size={16} /></button>
            </div>
          ) : mode === 'custom' ? (
            <div className="flex items-center gap-1.5">
              <Input type="date" value={customFrom} max={customTo || localToday()} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From" className="h-9 w-[138px] rounded-xl bg-background text-xs" data-testid="input-report-from" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={customTo} min={customFrom || undefined} max={localToday()} onChange={(e) => setCustomTo(e.target.value)} aria-label="To" className="h-9 w-[138px] rounded-xl bg-background text-xs" data-testid="input-report-to" />
            </div>
          ) : (
            <span className="text-[13px] font-semibold" data-testid="text-report-period">{data ? `${formatShortDate(data.range.from)} – ${formatDate(data.range.to)}` : 'All time'}</span>
          )}
          <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
            <Switch checked={includeReimbursable} onCheckedChange={setIncludeReimbursable} data-testid="switch-report-reimbursable" />
            Include reimbursable
          </label>
        </div>
        {chips.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5" role="tablist" aria-label="Country">
            {chips.map((loc) => {
              const active = loc.id === data?.location?.id;
              return (
                <button key={loc.id} type="button" role="tab" aria-selected={active} onClick={() => setLocationId(loc.id)} className={`min-h-9 rounded-xl px-3.5 text-[13px] font-semibold transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:text-foreground'}`} data-testid={`tab-report-country-${loc.slug}`}>{loc.name}</button>
              );
            })}
          </div>
        )}
      </section>

      {range === null ? (
        <p className="mt-6 text-sm text-muted-foreground" data-testid="text-report-custom-hint">Choose a start and end date.</p>
      ) : query.isLoading ? (
        <div className="mt-6 space-y-4" data-testid="status-reports-loading">
          <div className="grid grid-cols-3 gap-2.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          <Skeleton className="h-56 rounded-[22px]" />
          <Skeleton className="h-64 rounded-[22px]" />
        </div>
      ) : query.isError || !data ? (
        <section className="mt-6 rounded-[22px] border border-destructive/25 bg-card px-6 py-9 text-center" data-testid="status-reports-error">
          <div className="mx-auto grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert size={18} /></div>
          <p className="mt-4 font-display text-xl font-semibold">Reports didn’t load.</p>
          <p className="mt-2 text-sm text-muted-foreground">{errorText(query.error)}</p>
          <Button onClick={() => query.refetch()} variant="outline" className="mt-5 gap-2"><RotateCcw size={15} /> Try again</Button>
        </section>
      ) : !data.location || data.totals.length === 0 ? (
        <section className="mt-6 rounded-[24px] border border-dashed border-border bg-card/55 px-6 py-12 text-center" data-testid="status-reports-empty">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><Wallet size={20} strokeWidth={1.7} /></div>
          <p className="mt-5 font-display text-[21px] font-semibold tracking-[-.04em]">Nothing spent{data.location ? ` in ${data.location.name}` : ''} in this period.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Step back to an earlier period, pick a longer one, or choose another country.</p>
        </section>
      ) : (
        <div className={`mt-6 space-y-5 ${query.isFetching ? 'opacity-70' : ''} transition-opacity`}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" data-testid="section-report-kpis">
            <Kpi
              wide
              label={includeReimbursable ? 'Spent' : 'Own cost'}
              value={<Amounts totals={data.totals} />}
              testId="text-report-total"
              hint={showChange && change(data.totals, data.previousTotals) ? <span className="flex flex-wrap items-center gap-1"><ChangeBadge current={data.totals} previous={data.previousTotals} show /> <span>vs before</span></span> : undefined}
            />
            <Kpi label="Per day" value={<Amounts averages={data.averagePerDay} />} testId="text-report-per-day" hint={`${data.range.days} ${data.range.days === 1 ? 'day' : 'days'}`} />
            <Kpi
              label="Entries"
              value={String(entries)}
              testId="text-report-entries"
              hint={data.totals.length === 1 ? `avg ${money(Number(data.totals[0].total) / Math.max(entries, 1), data.totals[0].currency)}` : undefined}
            />
          </div>

          <Timeline data={data} expensesBase={expensesBase} />

          <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-report-categories">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary"><Layers3 size={16} /></span>
              <div>
                <h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">By category</h2>
                <p className="text-xs text-muted-foreground">Tap a category for its subcategories.</p>
              </div>
            </div>
            <ul className="mt-3">
              {data.categories.map((row) => {
                const key = `${data.location?.id}:${row.category.id}`;
                return (
                  <CategoryRow
                    key={row.category.id}
                    row={row}
                    locationId={data.location!.id}
                    range={data.range}
                    includeReimbursable={includeReimbursable}
                    showChange={showChange}
                    expanded={Boolean(expanded[key])}
                    onToggle={() => setExpanded((current) => ({ ...current, [key]: !current[key] }))}
                  />
                );
              })}
            </ul>
          </section>

          <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-report-top-expenses">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary"><ReceiptText size={16} /></span>
              <h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">Biggest expenses</h2>
            </div>
            <ul className="mt-3 divide-y divide-border/60">
              {data.topExpenses.map((expense) => (
                <li key={expense.id}>
                  <Link href={`/expenses/${expense.id}`} className="flex items-center justify-between gap-3 py-3" data-testid={`link-report-top-${expense.id}`}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: expense.category.color }} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold">{expense.description || expense.category.name}</span>
                        <span className="block text-[11px] text-muted-foreground">{expense.category.name} · {formatShortDate(expense.date)}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums">{money(expense.amount, expense.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <Breakdowns data={data} expensesBase={expensesBase} />

          <Link href={`/expenses?${expensesBase.toString()}`} className="flex items-center justify-between rounded-[18px] border border-border/70 bg-card px-5 py-4 text-sm font-semibold transition-colors hover:border-primary/30" data-testid="link-report-all-expenses">
            <span className="flex items-center gap-2"><Hash size={15} className="text-primary" /> See all {entries} expenses in this view</span>
            <ArrowRight size={16} className="text-primary" />
          </Link>
        </div>
      )}
    </div>
  );
}

export default ReportsPage;
