import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  ArrowLeft, ArrowUpRight, BriefcaseBusiness, Check, ChevronRight,
  CircleAlert, CreditCard, LoaderCircle, Plus, ReceiptText, RotateCcw,
  Tag, Trash2, Wallet,
} from 'lucide-react';
import {
  getGetExpenseQueryKey, getListExpensesQueryKey, useCreateExpense, useDeleteExpense, useGetExpense,
  useListCategories, useListExpenses, useListLabels, useListProjects, useUpdateExpense,
} from '@workspace/api-client-react';
import type { ExpenseInput, ExpenseRecord, ExpenseUpdate } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
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
const money = (amount: string | number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(amount || 0));
const dateLabel = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};
const errorText = (error: unknown) => {
  if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') return error.error;
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
};
const localToday = () => {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};
const defaultValues = (): ExpenseFormValues => ({
  amount: '', date: localToday(), projectId: '',
  categoryId: '', labelIds: [], description: '', paymentMethod: '', notes: '',
});
const fromExpense = (expense: ExpenseRecord): ExpenseFormValues => ({
  amount: expense.amount,
  date: expense.date.slice(0, 10),
  projectId: expense.projectId ?? '',
  categoryId: expense.categoryId,
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
  const query = useListExpenses();
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
      <div className="mt-7 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[19px] font-semibold tracking-[-.03em]">Your entries</h2>
          <p className="mt-1 text-xs text-muted-foreground">Every little detail, gathered in one place.</p>
        </div>
        {!query.isLoading && !query.isError && <span className="rounded-full bg-secondary px-3 py-1.5 text-[11px] font-semibold text-secondary-foreground" data-testid="text-expense-count">{query.data?.length ?? 0} {(query.data?.length ?? 0) === 1 ? 'entry' : 'entries'}</span>}
      </div>
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
      ) : query.data?.length ? (
        <div className="mt-5 space-y-2.5" data-testid="list-expenses">
          {query.data.map((expense) => (
            <Link key={expense.id} href={`/expenses/${expense.id}`} className="group flex min-w-0 items-center gap-3 rounded-[19px] border border-border/70 bg-card px-3.5 py-4 transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_12px_36px_-30px_hsl(163_18%_19%/.4)] sm:gap-4 sm:px-5" data-testid={`card-expense-${expense.id}`}>
              <CategoryMark color={expense.category.color} icon={expense.category.icon} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-semibold tracking-[-.02em]" data-testid={`text-expense-title-${expense.id}`}>{expense.description || expense.category.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground" data-testid={`text-expense-context-${expense.id}`}>
                  <span>{expense.category.name}</span><span aria-hidden="true">·</span><span>{dateLabel(expense.date)}</span>
                  {expense.project && <><span aria-hidden="true">·</span><span className="truncate">{expense.project.name}</span></>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-[15px] font-semibold tracking-[-.03em] tabular-nums" data-testid={`text-expense-amount-${expense.id}`}>{money(expense.amount)}</p>
                <div className="mt-1 flex justify-end gap-1">
                  {expense.labels.slice(0, 2).map((label) => <span key={label.id} className="size-1.5 rounded-full" style={{ backgroundColor: label.color }} title={label.name} />)}
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          ))}
        </div>
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const initializedId = useRef<string | null>(null);
  const form = useForm<ExpenseFormValues>({ resolver: zodResolver(expenseSchema), defaultValues: defaultValues() });
  const busy = createExpense.isPending || updateExpense.isPending;
  const expense = detailQuery.data;

  useEffect(() => {
    if (editing && expense && initializedId.current !== expense.id) {
      initializedId.current = expense.id;
      form.reset(fromExpense(expense));
    }
  }, [editing, expense, form]);

  const submit = (values: ExpenseFormValues) => {
    const data: ExpenseInput = {
      amount: values.amount.trim(),
      date: values.date,
      projectId: values.projectId || null,
      categoryId: values.categoryId,
      labelIds: values.labelIds,
      description: values.description.trim() || null,
      paymentMethod: values.paymentMethod || null,
      notes: values.notes.trim() || null,
    };
    if (editing && expenseId) {
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
    createExpense.mutate({ data }, {
      onSuccess: async (created) => {
        await queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
        toast({ title: 'Expense added', description: 'It’s been added to your spending.' });
        setLocation(`/expenses/${created.id}`);
      },
      onError: (error) => toast({ title: 'Could not add expense', description: errorText(error), variant: 'destructive' }),
    });
  };

  if (editing && detailQuery.isLoading) return <div className="page-enter" data-testid="status-expense-loading"><Skeleton className="mb-6 h-4 w-28" /><Skeleton className="h-12 w-64" /><Skeleton className="mt-7 h-64 rounded-[22px]" /></div>;
  if (editing && detailQuery.isError) return <section className="page-enter flex min-h-[50vh] flex-col items-start justify-center" data-testid="status-expense-error"><span className="mb-4 text-[10px] font-bold uppercase tracking-[.19em] text-primary">A SMALL INTERRUPTION</span><h1 className="font-display text-4xl font-semibold tracking-[-.055em]">Expense details didn’t load.</h1><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{errorText(detailQuery.error)}</p><Button onClick={() => detailQuery.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-expense"><RotateCcw size={15} /> Try again</Button><Link href="/expenses" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary" data-testid="link-expenses-from-error"><ArrowLeft size={15} /> All expenses</Link></section>;
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
        <form onSubmit={form.handleSubmit(submit)} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_270px]" data-testid="form-expense">
          <div className="space-y-5">
            <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-7">
              <div className="mb-6 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary"><ReceiptText size={17} /></span><div><h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">The essentials</h2><p className="text-xs text-muted-foreground">A few details to anchor this expense.</p></div></div>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField control={form.control} name="amount" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>Amount <span className="text-destructive">*</span></FormLabel><FormControl><div className="relative"><span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-xl font-semibold text-muted-foreground">₹</span><Input {...field} inputMode="decimal" autoComplete="off" placeholder="0.00" maxLength={15} className="h-[58px] rounded-xl bg-background pl-10 font-display text-[24px] font-semibold tracking-[-.04em] tabular-nums" data-testid="input-expense-amount" /></div></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="date" render={({ field }) => <FormItem><FormLabel>Date <span className="text-destructive">*</span></FormLabel><FormControl><Input {...field} type="date" className="h-11 rounded-xl bg-background" data-testid="input-expense-date" /></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="categoryId" render={({ field }) => <FormItem><FormLabel>Category <span className="text-destructive">*</span></FormLabel><FormControl><select {...field} aria-label="Category" className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring" data-testid="select-expense-category"><option value="">Choose a category</option>{(categoriesQuery.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></FormControl>{categoriesQuery.isError ? <p className="text-xs text-destructive">Categories could not be loaded.</p> : !categoriesQuery.isLoading && !categoriesQuery.data?.length ? <p className="text-xs text-muted-foreground" data-testid="status-no-expense-categories">No categories yet. <Link href="/categories" className="font-semibold text-primary hover:underline" data-testid="link-create-expense-category">Create one first.</Link></p> : null}<FormMessage /></FormItem>} />
                <FormField control={form.control} name="description" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>Description <span className="font-normal text-muted-foreground">(optional)</span></FormLabel><FormControl><Input {...field} maxLength={1000} placeholder="What was this for?" className="h-11 rounded-xl bg-background" data-testid="input-expense-description" /></FormControl><FormMessage /></FormItem>} />
              </div>
            </section>
            <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-7">
              <div className="mb-6 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-accent/65 text-accent-foreground"><BriefcaseBusiness size={17} /></span><div><h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">A little more context</h2><p className="text-xs text-muted-foreground">Optional details for later.</p></div></div>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField control={form.control} name="projectId" render={({ field }) => <FormItem><FormLabel>Project <span className="font-normal text-muted-foreground">(optional)</span></FormLabel><FormControl><select {...field} aria-label="Project" className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring" data-testid="select-expense-project"><option value="">No project</option>{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></FormControl>{projectsQuery.isError && <p className="text-xs text-destructive">Projects could not be loaded.</p>}<FormMessage /></FormItem>} />
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
              <Button type="submit" disabled={busy} className="h-11 gap-2 rounded-xl" data-testid="button-save-expense">{busy && <LoaderCircle size={15} className="animate-spin" />}{editing ? 'Save changes' : 'Save expense'}</Button>
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
  const deleteExpense = useDeleteExpense();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const expense = query.data;
  const removeExpense = () => {
    if (!expenseId) return;
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
  if (query.isError) return <section className="page-enter flex min-h-[50vh] flex-col items-start justify-center" data-testid="status-expense-detail-error"><span className="mb-4 text-[10px] font-bold uppercase tracking-[.19em] text-primary">A SMALL INTERRUPTION</span><h1 className="font-display text-4xl font-semibold tracking-[-.055em]">Expense details didn’t load.</h1><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{errorText(query.error)}</p><Button onClick={() => query.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-expense-detail"><RotateCcw size={15} /> Try again</Button><Link href="/expenses" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary" data-testid="link-expenses-from-detail-error"><ArrowLeft size={15} /> All expenses</Link></section>;
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
        <p className="relative mt-4 font-display text-[42px] font-semibold leading-none tracking-[-.06em] tabular-nums sm:text-[52px]" data-testid="text-expense-detail-amount">{money(expense.amount)}</p>
        <p className="relative mt-3 text-xs text-muted-foreground">{expense.project ? `Part of ${expense.project.name}` : 'Not connected to a project'}</p>
      </section>
      <section className="mt-5 rounded-[22px] border border-border/70 bg-card p-5 sm:p-7" data-testid="section-expense-context">
        <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary"><Tag size={16} /></span><div><h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">The context</h2><p className="text-xs text-muted-foreground">The useful details around this entry.</p></div></div>
        <dl className="mt-5 grid gap-x-8 sm:grid-cols-2">
          <div className="border-t border-border/70 py-4"><dt className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Category</dt><dd className="mt-1.5 flex items-center gap-2 text-sm font-semibold" data-testid="text-expense-detail-category"><span className="size-2.5 rounded-full" style={{ backgroundColor: expense.category.color }} />{expense.category.name}</dd></div>
          <div className="border-t border-border/70 py-4"><dt className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Project</dt><dd className="mt-1.5 text-sm font-semibold" data-testid="text-expense-detail-project">{expense.project?.name ?? 'None'}</dd></div>
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