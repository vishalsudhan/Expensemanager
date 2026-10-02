import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  ArrowLeft, ArrowUpRight, BriefcaseBusiness, Check, ChevronDown, ChevronRight,
  CircleAlert, CloudOff, CreditCard, LoaderCircle, Plus, ReceiptText, RefreshCw,
  RotateCcw, Search, SlidersHorizontal, Tag, Trash2, Wallet, X,
} from 'lucide-react';
import {
  getGetExpenseQueryKey, getListExpensesQueryKey, listExpenses, useCreateExpense,
  useDeleteExpense, useGetExpense, useListCategories, useListLabels, useListProjects,
  useUpdateExpense,
} from '@workspace/api-client-react';
import type {
  ExpenseInput, ExpenseRecord, ExpenseUpdate, ListExpensesParams, ListExpensesSort,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useOffline } from '@/components/offline-provider';
import { findCurrency, useCurrencyOptions } from '@/hooks/use-currencies';
import { enqueueExpense } from '@/lib/offline-store';
import { errorText, formatDate, formatTotals, money, moneyByCode } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const expenseSchema = z.object({
  amount: z.string().trim().min(1, 'Add an amount.').max(15, 'Amount is too long.')
    .regex(/^[0-9]{1,12}(\.[0-9]{1,2})?$/, 'Use a valid amount, such as 245.50.'),
  date: z.string().min(1, 'Choose a date.').regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date.'),
  projectId: z.string(),
  categoryId: z.string().min(1, 'Choose a category.'),
  currencyId: z.string().min(1, 'Choose a currency.'),
  labelIds: z.array(z.string()),
  description: z.string().max(1000, 'Keep the description under 1,000 characters.'),
  paymentMethod: z.enum(['', 'cash', 'credit_card', 'debit_card', 'bank_transfer', 'upi', 'other']),
  notes: z.string().max(4000, 'Keep notes under 4,000 characters.'),
});
type ExpenseFormValues = z.infer<typeof expenseSchema>;

const paymentOptions = [
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'debit_card', label: 'Debit card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'other', label: 'Other' },
] as const;
const sortOptions = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'highest', label: 'Highest amount' },
  { value: 'lowest', label: 'Lowest amount' },
] as const;
const PAGE_SIZE = 20;
const controlClass = 'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring';
const dateLabel = formatDate;
const isConnectionError = (error: unknown) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (error instanceof TypeError) return true;
  return Boolean(error && typeof error === 'object' && !('status' in error));
};
const localToday = () => {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};
const defaultValues = (currencyId = ''): ExpenseFormValues => ({
  amount: '', date: localToday(), projectId: '',
  categoryId: '', currencyId, labelIds: [], description: '', paymentMethod: '', notes: '',
});
const fromExpense = (expense: ExpenseRecord): ExpenseFormValues => ({
  amount: expense.amount,
  date: expense.date.slice(0, 10),
  projectId: expense.projectId ?? '',
  categoryId: expense.categoryId,
  currencyId: expense.currency?.id ?? '',
  labelIds: expense.labelIds ?? [],
  description: expense.description ?? '',
  paymentMethod: expense.paymentMethod ?? '',
  notes: expense.notes ?? '',
});

function CategoryMark({ color, icon }: { color: string; icon: string | null }) {
  return <span className="grid size-11 shrink-0 place-items-center rounded-[15px]" style={{ color, backgroundColor: `${color}1B` }}>
    {icon ? <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} /> : <ReceiptText size={18} strokeWidth={1.7} />}
  </span>;
}

export function ExpenseListPage() {
  const projectsQuery = useListProjects({ status: 'active' });
  const categoriesQuery = useListCategories({ status: 'active' });
  const labelsQuery = useListLabels({ status: 'active' });
  const { activeCurrencies: currencies } = useCurrencyOptions();
  const { pending, failedCount, retryFailed } = useOffline();

  const urlSearch = useSearch();
  const urlParams = useMemo(() => new URLSearchParams(urlSearch), [urlSearch]);

  const [search, setSearch] = useState(() => urlParams.get('search') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => urlParams.get('search') ?? '');
  const [from, setFrom] = useState(() => urlParams.get('from') ?? '');
  const [to, setTo] = useState(() => urlParams.get('to') ?? '');
  const [projectId, setProjectId] = useState(() => urlParams.get('projectId') ?? '');
  const [categoryId, setCategoryId] = useState(() => urlParams.get('categoryId') ?? '');
  const [labelId, setLabelId] = useState(() => urlParams.get('labelId') ?? '');
  const [paymentMethod, setPaymentMethod] = useState(() => urlParams.get('paymentMethod') ?? '');
  const [currencyId, setCurrencyId] = useState(() => urlParams.get('currencyId') ?? '');
  const [sort, setSort] = useState<ListExpensesSort>(() => {
    const value = urlParams.get('sort');
    return value && ['newest', 'oldest', 'highest', 'lowest'].includes(value) ? (value as ListExpensesSort) : 'newest';
  });
  const [filtersOpen, setFiltersOpen] = useState(() => ['from', 'to', 'projectId', 'categoryId', 'labelId', 'paymentMethod', 'currencyId'].some((key) => urlParams.has(key)));

  useEffect(() => {
    const params = new URLSearchParams(urlSearch);
    setFrom(params.get('from') ?? '');
    setTo(params.get('to') ?? '');
    setProjectId(params.get('projectId') ?? '');
    setCategoryId(params.get('categoryId') ?? '');
    setLabelId(params.get('labelId') ?? '');
    setPaymentMethod(params.get('paymentMethod') ?? '');
    setCurrencyId(params.get('currencyId') ?? '');
    const nextSearch = params.get('search') ?? '';
    setSearch(nextSearch);
    setDebouncedSearch(nextSearch);
    const nextSort = params.get('sort');
    if (nextSort && ['newest', 'oldest', 'highest', 'lowest'].includes(nextSort)) setSort(nextSort as ListExpensesSort);
    if (['from', 'to', 'projectId', 'categoryId', 'labelId', 'paymentMethod', 'currencyId'].some((key) => params.has(key))) setFiltersOpen(true);
  }, [urlSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const params = useMemo<ListExpensesParams>(() => ({
    search: debouncedSearch.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
    projectId: projectId || undefined,
    categoryId: categoryId || undefined,
    labelId: labelId || undefined,
    paymentMethod: (paymentMethod || undefined) as ListExpensesParams['paymentMethod'],
    currencyId: currencyId || undefined,
    sort,
    limit: PAGE_SIZE,
  }), [debouncedSearch, from, to, projectId, categoryId, labelId, paymentMethod, currencyId, sort]);

  const queryKey = useMemo(() => [...getListExpensesQueryKey(params), 'infinite'] as const, [params]);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => listExpenses({ ...params, offset: pageParam }, { signal }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined),
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  const totals = query.data?.pages[0]?.totals ?? [];

  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (from) activeFilters.push({ key: 'from', label: `From ${dateLabel(from)}`, clear: () => setFrom('') });
  if (to) activeFilters.push({ key: 'to', label: `To ${dateLabel(to)}`, clear: () => setTo('') });
  if (projectId) activeFilters.push({ key: 'project', label: projectsQuery.data?.find((project) => project.id === projectId)?.name ?? 'Project', clear: () => setProjectId('') });
  if (categoryId) activeFilters.push({ key: 'category', label: categoriesQuery.data?.find((category) => category.id === categoryId)?.name ?? 'Category', clear: () => setCategoryId('') });
  if (labelId) activeFilters.push({ key: 'label', label: labelsQuery.data?.find((label) => label.id === labelId)?.name ?? 'Label', clear: () => setLabelId('') });
  if (paymentMethod) activeFilters.push({ key: 'payment', label: paymentOptions.find((option) => option.value === paymentMethod)?.label ?? 'Payment method', clear: () => setPaymentMethod('') });
  if (currencyId) activeFilters.push({ key: 'currency', label: currencies.find((currency) => currency.id === currencyId)?.code ?? 'Currency', clear: () => setCurrencyId('') });

  const clearAll = () => {
    setSearch('');
    setFrom('');
    setTo('');
    setProjectId('');
    setCategoryId('');
    setLabelId('');
    setPaymentMethod('');
    setCurrencyId('');
  };

  const hasAnyFilter = activeFilters.length > 0 || debouncedSearch.trim().length > 0;

  return (
    <div className="page-enter">
      <p className="mb-7 text-[10px] font-bold uppercase tracking-[.19em] text-primary">YOUR SPENDING</p>
      <header className="flex flex-col gap-5 border-b border-border/80 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-[40px] font-semibold leading-none tracking-[-.055em] sm:text-[52px]" data-testid="heading-expenses">Expenses</h1>
          <p className="mt-4 max-w-[470px] text-[14px] leading-6 text-muted-foreground">A clear record of what you spend, with the details that make it yours.</p>
        </div>
        <Link href="/expenses/new" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="button-new-expense">
          <Plus size={16} /> Add expense
        </Link>
      </header>

      <section className="mt-7 rounded-[22px] border border-border/70 bg-card p-4 sm:p-5" data-testid="section-expense-toolbar">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search description, notes, category, or project"
              aria-label="Search expenses"
              className="h-11 rounded-xl bg-background pl-10 pr-9"
              data-testid="input-expense-search"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" data-testid="button-clear-expense-search">
                <X size={15} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-3.5 text-xs font-bold transition-colors lg:flex-none ${activeFilters.length ? 'border-primary/35 bg-secondary text-primary' : 'border-border bg-background text-foreground hover:bg-muted'}`}
              data-testid="button-toggle-expense-filters"
            >
              <SlidersHorizontal size={15} /> Filters{activeFilters.length ? ` (${activeFilters.length})` : ''}
            </button>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as ListExpensesSort)}
              aria-label="Sort expenses"
              className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring lg:w-auto lg:flex-none"
              data-testid="select-expense-sort"
            >
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>

        {filtersOpen && (
          <div className="mt-4 grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">From date</span>
              <Input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-xl bg-background" data-testid="input-expense-filter-from" />
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">To date</span>
              <Input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-xl bg-background" data-testid="input-expense-filter-to" />
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Project</span>
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className={controlClass} data-testid="select-expense-filter-project">
                <option value="">Any project</option>
                {(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Category</span>
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={controlClass} data-testid="select-expense-filter-category">
                <option value="">Any category</option>
                {(categoriesQuery.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Label</span>
              <select value={labelId} onChange={(event) => setLabelId(event.target.value)} className={controlClass} data-testid="select-expense-filter-label">
                <option value="">Any label</option>
                {(labelsQuery.data ?? []).map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Payment method</span>
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className={controlClass} data-testid="select-expense-filter-payment">
                <option value="">Any method</option>
                {paymentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Currency</span>
              <select value={currencyId} onChange={(event) => setCurrencyId(event.target.value)} className={controlClass} data-testid="select-expense-filter-currency">
                <option value="">Any currency</option>
                {currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.symbol} {currency.code} · {currency.name}</option>)}
              </select>
            </label>
          </div>
        )}

        {activeFilters.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeFilters.map((filter) => (
              <button key={filter.key} type="button" onClick={filter.clear} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border/70 bg-secondary/50 px-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground" data-testid={`chip-expense-filter-${filter.key}`}>
                {filter.label}<X size={12} />
              </button>
            ))}
            <button type="button" onClick={clearAll} className="inline-flex min-h-8 items-center px-2 text-[11px] font-bold text-primary hover:underline" data-testid="button-clear-expense-filters">Clear all</button>
          </div>
        )}
      </section>

      <div className="mt-7 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[19px] font-semibold tracking-[-.03em]">{hasAnyFilter ? 'Matching entries' : 'Your entries'}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {!query.isLoading && !query.isError && total > 0
              ? <>Total <span className="font-semibold text-foreground" data-testid="text-expense-total-amount">{formatTotals(totals)}</span> {hasAnyFilter ? 'matching your filters' : 'across every entry'}.</>
              : hasAnyFilter ? 'Refine the search or clear filters to see more.' : 'Every little detail, gathered in one place.'}
          </p>
        </div>
        {!query.isLoading && !query.isError && <span className="shrink-0 rounded-full bg-secondary px-3 py-1.5 text-[11px] font-semibold text-secondary-foreground" data-testid="text-expense-count">{total} {total === 1 ? 'entry' : 'entries'}</span>}
      </div>

      {pending.length > 0 && (
        <section className="mt-6 rounded-[20px] border border-primary/25 bg-secondary/40 p-4 sm:p-5" data-testid="section-pending-expenses">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><CloudOff size={16} /></span>
              <div>
                <h2 className="font-display text-[15px] font-semibold tracking-[-.02em]">Waiting to sync</h2>
                <p className="text-[11px] text-muted-foreground">Saved on this device. Sent automatically when you’re back online.</p>
              </div>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary" data-testid="text-pending-sync-count">{pending.length} {pending.length === 1 ? 'expense' : 'expenses'}</span>
          </div>
          <div className="mt-3 space-y-2" data-testid="list-pending-expenses">
            {pending.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center gap-3 rounded-[16px] border border-border/60 bg-card/80 px-3.5 py-3" data-testid={`card-pending-expense-${item.id}`}>
                <CategoryMark color={item.display.categoryColor} icon={item.display.categoryIcon} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[14px] font-semibold tracking-[-.02em]" data-testid={`text-pending-expense-title-${item.id}`}>{item.display.description || item.display.categoryName}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{item.display.categoryName}<span className="mx-1.5" aria-hidden="true">·</span>{dateLabel(item.display.date)}{item.display.projectName ? <><span className="mx-1.5" aria-hidden="true">·</span>{item.display.projectName}</> : null}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-[14px] font-semibold tabular-nums" data-testid={`text-pending-expense-amount-${item.id}`}>{moneyByCode(item.display.amount, item.display.currencyCode)}</p>
                  <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${item.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`} data-testid={`badge-pending-${item.id}`}>
                    {item.status === 'failed' ? <><CircleAlert size={11} /> Couldn’t sync</> : <>Pending sync</>}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {failedCount > 0 && (
            <Button onClick={() => void retryFailed()} variant="outline" className="mt-3 h-9 gap-2 rounded-xl text-xs" data-testid="button-retry-pending"><RefreshCw size={14} /> Try syncing again</Button>
          )}
        </section>
      )}

      {query.isLoading ? (
        <div className="mt-5 space-y-3" aria-label="Loading expenses" data-testid="status-expenses-loading">
          {[0, 1, 2].map((item) => <div key={item} className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card p-4 sm:p-5"><Skeleton className="size-11 rounded-[15px]" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-52" /></div><Skeleton className="h-5 w-20" /></div>)}
        </div>
      ) : query.isError ? (
        <section className="mt-6 rounded-[22px] border border-destructive/25 bg-card px-6 py-9 text-center" data-testid="status-expenses-error">
          <div className="mx-auto grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert size={18} /></div>
          <p className="mt-4 font-display text-xl font-semibold">Your expenses didn’t load.</p>
          <p className="mt-2 text-sm text-muted-foreground">{errorText(query.error)}</p>
          <Button onClick={() => query.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-expenses"><RotateCcw size={15} /> Try again</Button>
        </section>
      ) : items.length ? (
        <>
          <div className="mt-5 space-y-2.5" data-testid="list-expenses">
            {items.map((expense) => (
              <Link key={expense.id} href={`/expenses/${expense.id}`} className="group flex min-w-0 items-center gap-3 rounded-[19px] border border-border/70 bg-card px-3.5 py-4 transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_12px_36px_-30px_var(--hover-shadow)] sm:gap-4 sm:px-5" data-testid={`card-expense-${expense.id}`}>
                <CategoryMark color={expense.category.color} icon={expense.category.icon} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[15px] font-semibold tracking-[-.02em]" data-testid={`text-expense-title-${expense.id}`}>{expense.description || expense.category.name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground" data-testid={`text-expense-context-${expense.id}`}>
                    <span>{expense.category.name}</span><span aria-hidden="true">·</span><span>{dateLabel(expense.date)}</span>
                    <span aria-hidden="true">·</span><span data-testid={`text-expense-currency-${expense.id}`}>{expense.currency?.symbol} {expense.currency?.code}</span>
                    {expense.project && <><span aria-hidden="true">·</span><span className="truncate">{expense.project.name}</span></>}
                  </p>
                  {expense.labels.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid={`list-expense-labels-${expense.id}`}>
                      {expense.labels.slice(0, 3).map((label) => (
                        <span key={label.id} className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-secondary/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground" data-testid={`text-expense-label-${expense.id}-${label.id}`}>
                          <span className="size-1.5 rounded-full" style={{ backgroundColor: label.color }} />{label.name}
                        </span>
                      ))}
                      {expense.labels.length > 3 && <span className="text-[10px] font-semibold text-muted-foreground">+{expense.labels.length - 3}</span>}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-[15px] font-semibold tracking-[-.03em] tabular-nums" data-testid={`text-expense-amount-${expense.id}`}>{money(expense.amount, expense.currency)}</p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            ))}
          </div>
          {query.hasNextPage && (
            <div className="mt-5 flex flex-col items-center gap-2">
              <Button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} variant="outline" className="h-11 gap-2 rounded-xl" data-testid="button-load-more-expenses">
                {query.isFetchingNextPage ? <LoaderCircle size={15} className="animate-spin" /> : <ChevronDown size={15} />}
                {query.isFetchingNextPage ? 'Loading more…' : 'Load more'}
              </Button>
              <p className="text-[11px] text-muted-foreground">Showing {items.length} of {total}</p>
            </div>
          )}
        </>
      ) : hasAnyFilter ? (
        <section className="mt-6 rounded-[24px] border border-dashed border-border bg-card/55 px-6 py-12 text-center sm:py-16" data-testid="status-expenses-no-results">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><Search size={20} strokeWidth={1.7} /></div>
          <p className="mt-5 font-display text-[23px] font-semibold tracking-[-.04em]">No expenses match.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Try different words, widen the dates, or clear the filters to see everything again.</p>
          <Button onClick={clearAll} variant="outline" className="mt-6 gap-2" data-testid="button-reset-expense-filters"><RotateCcw size={15} /> Clear filters</Button>
        </section>
      ) : (
        <section className="mt-6 rounded-[24px] border border-dashed border-border bg-card/55 px-6 py-12 text-center sm:py-16" data-testid="status-expenses-empty">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><Wallet size={21} strokeWidth={1.7} /></div>
          <p className="mt-5 font-display text-[23px] font-semibold tracking-[-.04em]">A little space for what you spend.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Add an expense when you’re ready. A date and category are enough to begin; the rest is there when it helps.</p>
          <Link href="/expenses/new" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground" data-testid="button-create-first-expense"><Plus size={15} /> Add your first expense</Link>
        </section>
      )}
    </div>
  );
}

export function ExpenseEditorPage() {
  const params = useParams<{ expenseId?: string }>();
  const [location, setLocation] = useLocation();
  const expenseId = params.expenseId;
  const editing = Boolean(expenseId) && location.endsWith('/edit');
  const detailQuery = useGetExpense(expenseId ?? '', {
    query: { queryKey: getGetExpenseQueryKey(expenseId ?? ''), enabled: editing && Boolean(expenseId) },
  });
  const projectsQuery = useListProjects({ status: 'active' });
  const categoriesQuery = useListCategories({ status: 'active' });
  const labelsQuery = useListLabels({ status: 'active' });
  const { activeCurrencies: currencies, isLoading: currenciesLoading } = useCurrencyOptions();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { online } = useOffline();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const initializedId = useRef<string | null>(null);
  const form = useForm<ExpenseFormValues>({ resolver: zodResolver(expenseSchema), defaultValues: defaultValues() });
  const busy = createExpense.isPending || updateExpense.isPending;
  const expense = detailQuery.data;
  const currencyTouched = useRef(false);

  // The project's default currency is a starting point; the user stays in control.
  useEffect(() => {
    if (!currencies.length) return;
    const current = form.getValues('currencyId');
    if (current && currencies.some((currency) => currency.id === current)) return;
    const fallback = currencies[0].id;
    if (fallback !== current) {
      form.setValue('currencyId', fallback, { shouldValidate: false });
    }
  }, [currencies, form]);

  useEffect(() => {
    if (editing && expense && initializedId.current !== expense.id) {
      initializedId.current = expense.id;
      currencyTouched.current = true;
      form.reset(fromExpense(expense));
    }
  }, [editing, expense, form]);

  const applyProjectCurrency = (projectId: string) => {
    if (currencyTouched.current) return;
    const project = (projectsQuery.data ?? []).find((item) => item.id === projectId);
    if (project?.defaultCurrency?.id) {
      form.setValue('currencyId', project.defaultCurrency.id, { shouldValidate: false });
    }
  };

  const saveOffline = (values: ExpenseFormValues, data: ExpenseInput) => {
    const category = categoriesQuery.data?.find((item) => item.id === values.categoryId);
    const project = projectsQuery.data?.find((item) => item.id === values.projectId);
    const currency = findCurrency(currencies, values.currencyId);
    const selectedLabels = (labelsQuery.data ?? []).filter((label) => values.labelIds.includes(label.id));
    void enqueueExpense({
      input: data,
      display: {
        amount: data.amount,
        currencyCode: currency?.code ?? 'INR',
        currencySymbol: currency?.symbol ?? '₹',
        date: data.date,
        description: data.description ?? null,
        categoryName: category?.name ?? 'Uncategorized',
        categoryColor: category?.color ?? '#8a8a8a',
        categoryIcon: category?.icon ?? null,
        projectName: project?.name ?? null,
        labels: selectedLabels.map((label) => ({ name: label.name, color: label.color })),
      },
    });
    toast({
      title: 'Saved offline',
      description: 'This expense is saved on your device and will sync automatically.',
    });
    setLocation('/expenses');
  };

  const submit = (values: ExpenseFormValues) => {
    const data: ExpenseInput = {
      amount: values.amount.trim(),
      date: values.date,
      projectId: values.projectId || null,
      categoryId: values.categoryId,
      currencyId: values.currencyId,
      labelIds: values.labelIds,
      description: values.description.trim() || null,
      paymentMethod: values.paymentMethod || null,
      notes: values.notes.trim() || null,
    };
    if (editing && expenseId) {
      if (!online) {
        toast({ title: 'You’re offline', description: 'Reconnect to save your changes. Your edits stay in this form.', variant: 'destructive' });
        return;
      }
      const updateData: ExpenseUpdate = data;
      updateExpense.mutate({ expenseId, data: updateData }, {
        onSuccess: async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetExpenseQueryKey(expenseId) }),
          ]);
          toast({ title: 'Expense updated', description: 'Your changes are saved.' });
          setLocation(`/expenses/${expenseId}`);
        },
        onError: (error) => toast({ title: 'Could not update expense', description: errorText(error), variant: 'destructive' }),
      });
      return;
    }
    if (!online) {
      saveOffline(values, data);
      return;
    }
    createExpense.mutate({ data }, {
      onSuccess: async (created) => {
        await queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
        toast({ title: 'Expense added', description: 'It’s been added to your spending.' });
        setLocation(`/expenses/${created.id}`);
      },
      onError: (error) => {
        if (isConnectionError(error)) {
          saveOffline(values, data);
          return;
        }
        toast({ title: 'Could not add expense', description: errorText(error), variant: 'destructive' });
      },
    });
  };

  if (editing && detailQuery.isLoading) return <div className="page-enter" data-testid="status-expense-loading"><Skeleton className="mb-6 h-4 w-28" /><Skeleton className="h-12 w-64" /><Skeleton className="mt-7 h-64 rounded-[22px]" /></div>;
  if (editing && detailQuery.isError) {
    const notFound = (detailQuery.error as { status?: number })?.status === 404;
    return <section className="page-enter flex min-h-[50vh] flex-col items-start justify-center" data-testid={notFound ? 'status-expense-not-found' : 'status-expense-error'}><span className="mb-4 text-[10px] font-bold uppercase tracking-[.19em] text-primary">{notFound ? 'NO EXPENSE HERE' : 'A SMALL INTERRUPTION'}</span><h1 className="font-display text-4xl font-semibold tracking-[-.055em]">{notFound ? 'This expense isn’t here.' : 'Expense details didn’t load.'}</h1><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{notFound ? 'It may have been removed or the address may be incorrect.' : errorText(detailQuery.error)}</p>{!notFound && <Button onClick={() => detailQuery.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-expense"><RotateCcw size={15} /> Try again</Button>}<Link href="/expenses" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary" data-testid="link-expenses-from-error"><ArrowLeft size={15} /> All expenses</Link></section>;
  }
  if (editing && !expense) return <section className="page-enter" data-testid="status-expense-not-found"><h1 className="font-display text-3xl font-semibold">This expense isn’t here.</h1><Link href="/expenses" className="mt-5 inline-flex text-sm font-bold text-primary" data-testid="link-expenses-from-not-found">Back to expenses</Link></section>;

  return (
    <div className="page-enter">
      <Link href={editing && expenseId ? `/expenses/${expenseId}` : '/expenses'} className="mb-7 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary" data-testid="link-back-expenses"><ArrowLeft size={15} /> {editing ? 'Back to expense' : 'All expenses'}</Link>
      <header className="mb-7 border-b border-border/80 pb-7">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[.19em] text-primary">{editing ? 'REFINE THE DETAILS' : 'A MOMENT, REMEMBERED'}</p>
        <h1 className="font-display text-[37px] font-semibold leading-none tracking-[-.055em] sm:text-[46px]" data-testid="heading-expense-form">{editing ? 'Edit expense' : 'Add an expense'}</h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{editing ? 'Make any changes you need. Your record will be updated in place.' : 'Start with the amount and category. Add context if it feels useful.'}</p>
      </header>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit, (errors) => { const first = Object.keys(errors)[0]; if (first) form.setFocus(first as Parameters<typeof form.setFocus>[0]); })} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_270px]" data-testid="form-expense">
          <div className="space-y-5">
            <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-7">
              <div className="mb-6 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary"><ReceiptText size={17} /></span><div><h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">The essentials</h2><p className="text-xs text-muted-foreground">A few details to anchor this expense.</p></div></div>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField control={form.control} name="amount" render={({ field }) => <FormItem><FormLabel>Amount <span className="text-destructive">*</span></FormLabel><FormControl><div className="relative"><span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-xl font-semibold text-muted-foreground" data-testid="text-expense-amount-symbol">{findCurrency(currencies, form.watch('currencyId'))?.symbol ?? '₹'}</span><Input {...field} inputMode="decimal" autoComplete="off" placeholder="0.00" maxLength={15} className="h-[58px] rounded-xl bg-background pl-10 font-display text-[24px] font-semibold tracking-[-.04em] tabular-nums" data-testid="input-expense-amount" /></div></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="currencyId" render={({ field }) => <FormItem><FormLabel>Currency <span className="text-destructive">*</span></FormLabel><FormControl><select {...field} disabled={currenciesLoading} onChange={(event) => { currencyTouched.current = true; field.onChange(event); }} aria-label="Currency" className="h-[58px] w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" data-testid="select-expense-currency"><option value="">{currenciesLoading ? 'Loading currencies…' : 'Choose a currency'}</option>{currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.symbol} {currency.code} · {currency.name}</option>)}</select></FormControl><p className="text-[11px] text-muted-foreground" data-testid="text-expense-currency-hint">Amounts are kept in this currency. Nothing is converted.</p><FormMessage /></FormItem>} />
                <FormField control={form.control} name="date" render={({ field }) => <FormItem><FormLabel>Date <span className="text-destructive">*</span></FormLabel><FormControl><Input {...field} type="date" className="h-11 rounded-xl bg-background" data-testid="input-expense-date" /></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="categoryId" render={({ field }) => <FormItem><FormLabel>Category <span className="text-destructive">*</span></FormLabel><FormControl><select {...field} aria-label="Category" className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring" data-testid="select-expense-category"><option value="">Choose a category</option>{(categoriesQuery.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></FormControl>{categoriesQuery.isError ? <p className="text-xs text-destructive">Categories could not be loaded.</p> : !categoriesQuery.isLoading && !categoriesQuery.data?.length ? <p className="text-xs text-muted-foreground" data-testid="status-no-expense-categories">No categories yet. <Link href="/categories" className="font-semibold text-primary hover:underline" data-testid="link-create-expense-category">Create one first.</Link></p> : null}<FormMessage /></FormItem>} />
                <FormField control={form.control} name="description" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>Description <span className="font-normal text-muted-foreground">(optional)</span></FormLabel><FormControl><Input {...field} maxLength={1000} placeholder="What was this for?" className="h-11 rounded-xl bg-background" data-testid="input-expense-description" /></FormControl><FormMessage /></FormItem>} />
              </div>
            </section>
            <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-7">
              <div className="mb-6 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-accent/65 text-accent-foreground"><BriefcaseBusiness size={17} /></span><div><h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">A little more context</h2><p className="text-xs text-muted-foreground">Optional details for later.</p></div></div>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField control={form.control} name="projectId" render={({ field }) => <FormItem><FormLabel>Project <span className="font-normal text-muted-foreground">(optional)</span></FormLabel><FormControl><select {...field} onChange={(event) => { field.onChange(event); applyProjectCurrency(event.target.value); }} aria-label="Project" className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring" data-testid="select-expense-project"><option value="">No project</option>{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></FormControl>{projectsQuery.isError && <p className="text-xs text-destructive">Projects could not be loaded.</p>}<FormMessage /></FormItem>} />
                <FormField control={form.control} name="paymentMethod" render={({ field }) => <FormItem><FormLabel>Payment method <span className="font-normal text-muted-foreground">(optional)</span></FormLabel><FormControl><select {...field} aria-label="Payment method" className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring" data-testid="select-expense-payment"><option value="">Not specified</option>{paymentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="labelIds" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>Labels <span className="font-normal text-muted-foreground">(optional)</span></FormLabel><FormControl><div className="flex min-h-11 flex-wrap gap-2" role="group" aria-label="Expense labels" data-testid="group-expense-labels">{(labelsQuery.data ?? []).length ? (labelsQuery.data ?? []).map((label) => { const selected = field.value.includes(label.id); return <button key={label.id} type="button" aria-pressed={selected} onClick={() => field.onChange(selected ? field.value.filter((id) => id !== label.id) : [...field.value, label.id])} className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-colors ${selected ? 'border-primary/35 bg-secondary text-primary' : 'border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-primary'}`} data-testid={`button-expense-label-${label.id}`}><span className="size-2 rounded-full" style={{ backgroundColor: label.color }} />{label.name}{selected && <Check size={13} />}</button>; }) : <p className="py-2 text-xs text-muted-foreground">{labelsQuery.isError ? 'Labels could not be loaded.' : 'No labels yet. You can leave this empty.'}</p>}</div></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="notes" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>Notes <span className="font-normal text-muted-foreground">(optional)</span></FormLabel><FormControl><Textarea {...field} maxLength={4000} rows={3} placeholder="A note for future you…" className="resize-y rounded-xl bg-background" data-testid="input-expense-notes" /></FormControl><FormMessage /></FormItem>} />
              </div>
            </section>
          </div>
          <aside className="lg:sticky lg:top-[94px] lg:self-start">
            <section className="rounded-[22px] border border-border/70 bg-secondary/45 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Before you save</p>
              <div className="mt-4 space-y-3 text-xs leading-5 text-muted-foreground">
                <p className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />Amount, date, and category keep the record clear.</p>
                <p className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#b9795e]" />Project, labels, and notes are always optional.</p>
              </div>
            </section>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row lg:flex-col">
              <Link href={editing && expenseId ? `/expenses/${expenseId}` : '/expenses'} className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted" data-testid="button-cancel-expense">Cancel</Link>
              <Button type="submit" disabled={busy || currenciesLoading} className="h-11 gap-2 rounded-xl" data-testid="button-save-expense">{busy && <LoaderCircle size={15} className="animate-spin" />}{editing ? 'Save changes' : 'Save expense'}</Button>
            </div>
          </aside>
        </form>
      </Form>
    </div>
  );
}

export function ExpenseDetailPage() {
  const { expenseId = '' } = useParams<{ expenseId: string }>();
  const [, setLocation] = useLocation();
  const query = useGetExpense(expenseId, {
    query: { queryKey: getGetExpenseQueryKey(expenseId), enabled: Boolean(expenseId) },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { online } = useOffline();
  const deleteExpense = useDeleteExpense();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const expense = query.data;
  const removeExpense = () => {
    if (!expenseId) return;
    if (!online) {
      toast({ title: 'You’re offline', description: 'Reconnect to delete this expense.', variant: 'destructive' });
      setConfirmDelete(false);
      return;
    }
    deleteExpense.mutate({ expenseId }, {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetExpenseQueryKey(expenseId) }),
        ]);
        toast({ title: 'Expense deleted', description: 'The entry has been removed.' });
        setLocation('/expenses');
      },
      onError: (error) => toast({ title: 'Could not delete expense', description: errorText(error), variant: 'destructive' }),
    });
  };
  if (query.isLoading) return <div className="page-enter" data-testid="status-expense-detail-loading"><Skeleton className="mb-6 h-4 w-28" /><Skeleton className="h-14 w-72" /><Skeleton className="mt-7 h-52 rounded-[22px]" /><Skeleton className="mt-4 h-40 rounded-[22px]" /></div>;
  if (query.isError) {
    const notFound = (query.error as { status?: number })?.status === 404;
    return <section className="page-enter flex min-h-[50vh] flex-col items-start justify-center" data-testid={notFound ? 'status-expense-detail-not-found' : 'status-expense-detail-error'}><span className="mb-4 text-[10px] font-bold uppercase tracking-[.19em] text-primary">{notFound ? 'NO EXPENSE HERE' : 'A SMALL INTERRUPTION'}</span><h1 className="font-display text-4xl font-semibold tracking-[-.055em]">{notFound ? 'This expense isn’t here.' : 'Expense details didn’t load.'}</h1><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{notFound ? 'It may have been removed or the address may be incorrect.' : errorText(query.error)}</p>{!notFound && <Button onClick={() => query.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-expense-detail"><RotateCcw size={15} /> Try again</Button>}<Link href="/expenses" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary" data-testid="link-expenses-from-detail-error"><ArrowLeft size={15} /> All expenses</Link></section>;
  }
  if (!expense) return <section className="page-enter" data-testid="status-expense-detail-not-found"><h1 className="font-display text-3xl font-semibold">This expense isn’t here.</h1><Link href="/expenses" className="mt-5 inline-flex text-sm font-bold text-primary" data-testid="link-expenses-from-detail-not-found">Back to expenses</Link></section>;
  const payment = paymentOptions.find((option) => option.value === expense.paymentMethod)?.label ?? null;
  return (
    <div className="page-enter">
      <Link href="/expenses" className="mb-7 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary" data-testid="link-back-expense-list"><ArrowLeft size={15} /> All expenses</Link>
      <header className="flex flex-col gap-5 border-b border-border/80 pb-7 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <CategoryMark color={expense.category.color} icon={expense.category.icon} />
          <div className="min-w-0"><p className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">EXPENSE DETAILS</p><h1 className="break-words font-display text-[32px] font-semibold leading-tight tracking-[-.055em] sm:text-[42px]" data-testid="heading-expense-detail">{expense.description || expense.category.name}</h1><p className="mt-2 text-sm text-muted-foreground">{expense.category.name}<span className="mx-2">·</span>{dateLabel(expense.date)}</p></div>
        </div>
        <div className="flex gap-2 sm:pt-1">
          <Link href={`/expenses/${expense.id}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3.5 text-xs font-bold hover:bg-muted" data-testid="button-edit-expense"><ArrowUpRight size={14} /> Edit</Link>
          <Button variant="outline" onClick={() => setConfirmDelete(true)} className="h-10 gap-2 rounded-xl border-destructive/25 px-3.5 text-xs font-bold text-destructive hover:bg-destructive/5 hover:text-destructive" data-testid="button-delete-expense"><Trash2 size={14} /> Delete</Button>
        </div>
      </header>
      <section className="relative mt-6 overflow-hidden rounded-[24px] border border-border/70 bg-card p-6 sm:p-8" data-testid="card-expense-amount">
        <div className="absolute -right-10 -top-14 size-48 rounded-full border border-primary/10" /><div className="absolute -right-1 -top-5 size-32 rounded-full border border-primary/10" />
        <p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Amount</p>
        <p className="relative mt-4 font-display text-[42px] font-semibold leading-none tracking-[-.06em] tabular-nums sm:text-[52px]" data-testid="text-expense-detail-amount">{money(expense.amount, expense.currency)}</p>
        <p className="relative mt-3 text-xs text-muted-foreground" data-testid="text-expense-detail-currency">{expense.currency?.symbol} {expense.currency?.code} · {expense.currency?.name}<span className="mx-2">·</span>{expense.project ? `Part of ${expense.project.name}` : 'Not connected to a project'}</p>
      </section>
      <section className="mt-5 rounded-[22px] border border-border/70 bg-card p-5 sm:p-7" data-testid="section-expense-context">
        <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary"><Tag size={16} /></span><div><h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">The context</h2><p className="text-xs text-muted-foreground">The useful details around this entry.</p></div></div>
        <dl className="mt-5 grid gap-x-8 sm:grid-cols-2">
          <div className="border-t border-border/70 py-4"><dt className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Category</dt><dd className="mt-1.5 flex items-center gap-2 text-sm font-semibold" data-testid="text-expense-detail-category"><span className="size-2.5 rounded-full" style={{ backgroundColor: expense.category.color }} />{expense.category.name}</dd></div>
          <div className="border-t border-border/70 py-4"><dt className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Project</dt><dd className="mt-1.5 text-sm font-semibold" data-testid="text-expense-detail-project">{expense.project?.name ?? 'None'}</dd></div>
          <div className="border-t border-border/70 py-4"><dt className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Currency</dt><dd className="mt-1.5 text-sm font-semibold" data-testid="text-expense-detail-currency-code">{expense.currency?.symbol} {expense.currency?.code} · {expense.currency?.name}</dd></div>
          <div className="border-t border-border/70 py-4"><dt className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Date</dt><dd className="mt-1.5 text-sm font-semibold" data-testid="text-expense-detail-date">{dateLabel(expense.date)}</dd></div>
          <div className="border-t border-border/70 py-4"><dt className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Payment method</dt><dd className="mt-1.5 flex items-center gap-2 text-sm font-semibold" data-testid="text-expense-detail-payment">{payment ? <><CreditCard size={15} className="text-muted-foreground" />{payment}</> : 'Not specified'}</dd></div>
          <div className="border-t border-border/70 py-4 sm:col-span-2"><dt className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Labels</dt><dd className="mt-2 flex flex-wrap gap-2" data-testid="list-expense-detail-labels">{expense.labels.length ? expense.labels.map((label) => <Badge key={label.id} variant="secondary" className="gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold"><span className="size-2 rounded-full" style={{ backgroundColor: label.color }} />{label.name}</Badge>) : <span className="text-sm text-muted-foreground">No labels</span>}</dd></div>
          {expense.notes && <div className="border-t border-border/70 py-4 sm:col-span-2"><dt className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Notes</dt><dd className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground" data-testid="text-expense-detail-notes">{expense.notes}</dd></div>}
        </dl>
      </section>
      <p className="mt-5 text-right text-[10px] text-muted-foreground" data-testid="text-expense-updated">Updated {dateLabel(expense.updatedAt)}</p>
      <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!deleteExpense.isPending) setConfirmDelete(open); }}>
        <AlertDialogContent className="rounded-[22px] border-border bg-card" data-testid="dialog-delete-expense">
          <AlertDialogHeader><AlertDialogTitle className="font-display text-xl tracking-[-.03em]">Delete this expense?</AlertDialogTitle><AlertDialogDescription>This removes the {money(expense.amount)} entry from your records. This can’t be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={deleteExpense.isPending} data-testid="button-cancel-delete-expense">Keep expense</AlertDialogCancel><AlertDialogAction disabled={deleteExpense.isPending} onClick={(event) => { event.preventDefault(); removeExpense(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-expense">{deleteExpense.isPending ? 'Deleting…' : 'Delete expense'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ExpensesPage() {
  const [location] = useLocation();
  const params = useParams<{ expenseId?: string }>();
  if (location === '/expenses/new' || location.endsWith('/edit')) return <ExpenseEditorPage />;
  if (params.expenseId) return <ExpenseDetailPage />;
  return <ExpenseListPage />;
}

export default ExpensesPage;