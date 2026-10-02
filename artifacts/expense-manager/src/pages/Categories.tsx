import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  Archive, ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleDollarSign,
  Coffee, House, LoaderCircle, Pencil, Plus, RotateCcw, Search, ShoppingBag,
  Sparkles, Tag, TrainFront, Utensils, Wallet, Wifi,
} from 'lucide-react';
import {
  getGetCategoryQueryKey, getListCategoriesQueryKey, useArchiveCategory,
  useCreateCategory, useGetCategory, useListCategories, useUpdateCategory,
} from '@workspace/api-client-react';
import type { Category, CategoryInput, CategoryUpdate, ListCategoriesParams } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { errorText, formatDate, formatTotals, money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

const colors = ['#47796A', '#B9795E', '#66869A', '#9C8050', '#7D7397', '#71834E', '#C16D61', '#5C7D84'];
const icons = [
  { value: 'Tag', label: 'General', Icon: Tag },
  { value: 'House', label: 'Home', Icon: House },
  { value: 'Utensils', label: 'Dining', Icon: Utensils },
  { value: 'Coffee', label: 'Coffee', Icon: Coffee },
  { value: 'ShoppingBag', label: 'Shopping', Icon: ShoppingBag },
  { value: 'TrainFront', label: 'Travel', Icon: TrainFront },
  { value: 'Sparkles', label: 'Personal', Icon: Sparkles },
  { value: 'Wifi', label: 'Bills', Icon: Wifi },
] as const;
const iconMap = Object.fromEntries(icons.map(({ value, Icon }) => [value, Icon]));
const formSchema = z.object({
  name: z.string().trim().min(1, 'Give this category a name.').max(80, 'Keep the name under 80 characters.'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a valid color.'),
  icon: z.string().max(64),
});
type FormValues = z.infer<typeof formSchema>;
const dateLabel = formatDate;

function CategoryIcon({ name, size = 20 }: { name: string | null; size?: number }) {
  const Icon = iconMap[name || ''] ?? Tag;
  return <Icon size={size} strokeWidth={1.8} />;
}

function CategoryFormDialog({ open, onOpenChange, category }: {
  open: boolean; onOpenChange: (open: boolean) => void; category?: Category | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const editing = Boolean(category);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: category?.name ?? '', color: category?.color ?? colors[0], icon: category?.icon ?? 'Tag' },
  });
  const busy = createCategory.isPending || updateCategory.isPending;
  const submit = (values: FormValues) => {
    if (category) {
      const data: CategoryUpdate = { name: values.name, color: values.color, icon: values.icon };
      updateCategory.mutate({ categoryId: category.id, data }, {
        onSuccess: async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetCategoryQueryKey(category.id) }),
          ]);
          toast({ title: 'Category updated', description: 'Your changes are saved.' });
          onOpenChange(false);
        },
        onError: (error) => toast({ title: 'Could not update category', description: errorText(error), variant: 'destructive' }),
      });
      return;
    }
    const data: CategoryInput = { name: values.name, color: values.color, icon: values.icon };
    createCategory.mutate({ data }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
        toast({ title: 'Category created', description: `${values.name} is ready to use anywhere.` });
        onOpenChange(false);
      },
      onError: (error) => toast({
        title: 'Could not create category',
        description: /duplicate|already exists|unique/i.test(errorText(error))
          ? 'A category with this name already exists. Try a different name.'
          : errorText(error),
        variant: 'destructive',
      }),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px] rounded-[24px] border-border bg-card p-6 sm:p-8" data-testid="dialog-category-form">
        <DialogHeader>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">{editing ? 'MAKE IT FEEL RIGHT' : 'A NEW WAY TO SORT'}</p>
          <DialogTitle className="font-display text-2xl tracking-[-.04em]">{editing ? 'Edit category' : 'Create a category'}</DialogTitle>
          <DialogDescription className="leading-6">A category you create here is yours to use across every project.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="mt-2 space-y-5" data-testid="form-category">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Category name</FormLabel><FormControl><Input {...field} autoFocus maxLength={80} placeholder="e.g. Market runs" className="h-11 rounded-xl bg-background" data-testid="input-category-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="color" render={({ field }) => (
              <FormItem><FormLabel>Color</FormLabel><FormControl>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Category color" data-testid="group-category-colors">
                  {colors.map((color) => <button key={color} type="button" aria-label={`Choose ${color} category color`} aria-pressed={field.value === color} onClick={() => field.onChange(color)} className="grid size-9 place-items-center rounded-full border-2 transition-transform hover:scale-105" style={{ borderColor: field.value === color ? color : 'transparent' }} data-testid={`button-category-color-${color.slice(1)}`}><span className="grid size-6 place-items-center rounded-full" style={{ backgroundColor: color }}>{field.value === color && <Check size={15} className="text-white" />}</span></button>)}
                </div>
              </FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="icon" render={({ field }) => (
              <FormItem><FormLabel>Icon</FormLabel><FormControl>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Category icon" data-testid="group-category-icons">
                  {icons.map(({ value, label, Icon }) => <button key={value} type="button" aria-label={`Choose ${label} icon`} aria-pressed={field.value === value} onClick={() => field.onChange(value)} className={`grid size-10 place-items-center rounded-xl border transition-colors ${field.value === value ? 'border-primary bg-secondary text-primary' : 'border-border bg-background text-muted-foreground hover:text-primary'}`} data-testid={`button-category-icon-${value}`}><Icon size={17} /></button>)}
                </div>
              </FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-category">Cancel</Button>
              <Button type="submit" disabled={busy} className="gap-2" data-testid="button-save-category">{busy && <LoaderCircle size={15} className="animate-spin" />}{editing ? 'Save changes' : 'Create category'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveConfirmation({ category, open, onOpenChange }: { category: Category | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const archive = useArchiveCategory();
  const confirm = () => {
    if (!category) return;
    archive.mutate({ categoryId: category.id }, {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetCategoryQueryKey(category.id) }),
        ]);
        toast({ title: 'Category archived', description: `${category.name} is now in your archive.` });
        onOpenChange(false);
      },
      onError: (error) => toast({ title: 'Could not archive category', description: errorText(error), variant: 'destructive' }),
    });
  };
  return <AlertDialog open={open} onOpenChange={(value) => { if (!value && !archive.isPending) onOpenChange(false); }}>
    <AlertDialogContent className="rounded-[22px] border-border bg-card" data-testid="dialog-archive-category">
      <AlertDialogHeader><AlertDialogTitle className="font-display text-xl tracking-[-.03em]">Archive {category?.name}?</AlertDialogTitle><AlertDialogDescription>This keeps its spending history intact. It will no longer appear with active categories.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={archive.isPending} data-testid="button-cancel-archive-category">Keep category</AlertDialogCancel><AlertDialogAction disabled={archive.isPending} onClick={(event) => { event.preventDefault(); confirm(); }} data-testid="button-confirm-archive-category">{archive.isPending ? 'Archiving…' : 'Archive category'}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

export function CategoryListPage() {
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [archiving, setArchiving] = useState<Category | null>(null);
  const params: ListCategoriesParams = { status, ...(search.trim() ? { search: search.trim() } : {}) };
  const query = useListCategories(params);
  const openForm = (category: Category | null = null) => { setEditing(category); setFormOpen(true); };
  return <div className="page-enter">
    <div className="mb-7 text-[10px] font-bold uppercase tracking-[.19em] text-primary">A LITTLE ORDER</div>
    <div className="flex flex-col gap-5 border-b border-border/80 pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="font-display text-[40px] font-semibold leading-none tracking-[-.055em] sm:text-[52px]" data-testid="heading-categories">Categories</h1><p className="mt-4 max-w-[470px] text-[14px] leading-6 text-muted-foreground">A familiar way to see where your money goes. Set it up once, use it anywhere.</p></div>
      <Button onClick={() => openForm()} className="h-11 gap-2 rounded-xl px-4" data-testid="button-new-category"><Plus size={16} /> New category</Button>
    </div>
    <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-[340px]"><Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a category" aria-label="Search categories" className="h-11 rounded-xl bg-card pl-10" data-testid="input-search-categories" /></div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex rounded-xl bg-secondary/65 p-1" role="tablist" aria-label="Category status">{(['active', 'archived'] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={status === tab} onClick={() => setStatus(tab)} data-testid={`tab-categories-${tab}`} className={`min-h-9 rounded-lg px-4 text-xs font-bold capitalize transition-colors ${status === tab ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{tab}</button>)}</div>
        {!query.isLoading && !query.isError && <span className="hidden text-xs text-muted-foreground sm:inline" data-testid="text-category-count">{query.data?.length ?? 0} {status}</span>}
      </div>
    </div>
    {query.isLoading ? <div className="mt-5 space-y-3" aria-label="Loading categories" data-testid="status-categories-loading">{[0, 1, 2].map((n) => <div key={n} className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card p-5"><Skeleton className="size-12 rounded-2xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-52" /></div><Skeleton className="h-8 w-20" /></div>)}</div>
      : query.isError ? <section className="mt-6 rounded-[22px] border border-destructive/25 bg-card px-6 py-9 text-center" data-testid="status-categories-error"><p className="font-display text-xl font-semibold">Your categories didn’t load.</p><p className="mt-2 text-sm text-muted-foreground">{errorText(query.error)}</p><Button onClick={() => query.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-categories"><RotateCcw size={15} /> Try again</Button></section>
      : query.data?.length ? <div className="mt-5 space-y-3" data-testid="list-categories">
        {query.data.map((category, index) => <article key={category.id} className="group relative flex flex-col gap-4 rounded-[20px] border border-border/70 bg-card px-4 py-4 transition-all hover:border-primary/25 hover:shadow-[0_12px_36px_-30px_var(--hover-shadow)] sm:flex-row sm:items-center sm:px-5" data-testid={`card-category-${category.id}`}>
          <div className="flex min-w-0 flex-1 items-center gap-4"><div className="grid size-12 shrink-0 place-items-center rounded-[16px]" style={{ backgroundColor: `${category.color}1B`, color: category.color }} data-testid={`icon-category-${category.id}`}><CategoryIcon name={category.icon} /></div><div className="min-w-0"><Link href={`/categories/${category.id}`} className="inline-flex max-w-full items-center gap-1.5 font-display text-[17px] font-semibold tracking-[-.025em] hover:text-primary" data-testid={`link-category-${category.id}`}><span className="truncate">{category.name}</span><ArrowUpRight size={14} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" /></Link><p className="mt-1 text-xs text-muted-foreground">{category.expenseCount} {category.expenseCount === 1 ? 'expense' : 'expenses'} <span className="mx-1">·</span> {formatTotals(category.totals)} spent</p></div></div>
          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3 sm:justify-end sm:border-0 sm:pt-0">
            <div className="text-right"><p className="font-display text-[16px] font-semibold tracking-[-.03em]" data-testid={`text-category-spent-${category.id}`}>{formatTotals(category.totals)}</p><p className="mt-0.5 text-[10px] uppercase tracking-[.12em] text-muted-foreground">{category.expenseCount} entries</p></div>
            {status === 'active' ? <div className="flex items-center gap-1"><button type="button" onClick={() => openForm(category)} aria-label={`Edit ${category.name}`} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary" data-testid={`button-edit-category-${category.id}`}><Pencil size={15} /></button><button type="button" onClick={() => setArchiving(category)} aria-label={`Archive ${category.name}`} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground" data-testid={`button-archive-category-${category.id}`}><Archive size={15} /></button><Link href={`/categories/${category.id}`} aria-label={`View ${category.name}`} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary" data-testid={`button-view-category-${category.id}`}><ChevronRight size={17} /></Link></div> : <Badge variant="secondary" className="gap-1.5 rounded-full px-2.5 py-1 text-[10px] capitalize"><Archive size={12} /> Archived</Badge>}
          </div><span className="sr-only" data-testid={`text-category-order-${category.id}`}>{index + 1}</span>
        </article>)}
      </div> : <section className="mt-6 rounded-[24px] border border-dashed border-border bg-card/55 px-6 py-12 text-center sm:py-16" data-testid="status-categories-empty">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><Tag size={21} /></div><p className="mt-5 font-display text-[23px] font-semibold tracking-[-.04em]">{search ? 'No category found.' : status === 'active' ? 'A simple place to start.' : 'Your archive is quiet.'}</p><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{search ? 'Try a different search, or clear it to see every category.' : status === 'active' ? 'Create a few categories that sound like your life. They’ll be ready to use everywhere.' : 'Categories you archive will stay here with their history intact.'}</p>{status === 'active' && !search && <Button onClick={() => openForm()} className="mt-6 gap-2" data-testid="button-create-first-category"><Plus size={16} /> Create your first category</Button>}
      </section>}
    <CategoryFormDialog key={`${formOpen ? 'open' : 'closed'}-${editing?.id ?? 'new'}`} open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }} category={editing} />
    <ArchiveConfirmation category={archiving} open={Boolean(archiving)} onOpenChange={(open) => { if (!open) setArchiving(null); }} />
  </div>;
}

export function CategoryDetailPage() {
  const { categoryId = '' } = useParams<{ categoryId: string }>();
  const [formOpen, setFormOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const query = useGetCategory(categoryId, { query: { queryKey: getGetCategoryQueryKey(categoryId), enabled: Boolean(categoryId) } });
  const detail = query.data;
  const category = detail?.category;
  const maxSpend = Math.max(...(detail?.monthlySpending ?? []).flatMap((month) => month.totals.map((entry) => Number(entry.total))), 1);
  if (query.isLoading) return <div className="page-enter" data-testid="status-category-detail-loading"><Skeleton className="mb-5 h-3 w-32" /><Skeleton className="h-14 w-64" /><Skeleton className="mt-4 h-5 w-80" /><div className="mt-9 grid gap-4 sm:grid-cols-2"><Skeleton className="h-36 rounded-2xl" /><Skeleton className="h-36 rounded-2xl" /></div><Skeleton className="mt-7 h-56 rounded-2xl" /></div>;
  if (query.isError) {
    const notFound = (query.error as { status?: number })?.status === 404;
    return <section className="page-enter flex min-h-[55vh] flex-col items-start justify-center" data-testid={notFound ? 'status-category-not-found' : 'status-category-detail-error'}><span className="mb-4 text-[10px] font-bold uppercase tracking-[.19em] text-primary">{notFound ? 'NO CATEGORY HERE' : 'A SMALL INTERRUPTION'}</span><h1 className="font-display text-4xl font-semibold tracking-[-.055em]">{notFound ? 'This category isn’t here.' : 'Category details didn’t load.'}</h1><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{notFound ? 'It may have been removed or the address may be incorrect.' : errorText(query.error)}</p>{!notFound && <Button onClick={() => query.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-category-detail"><RotateCcw size={15} /> Try again</Button>}<Link href="/categories" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline" data-testid="link-categories-from-error"><ArrowLeft size={15} /> All categories</Link></section>;
  }
  if (!detail || !category) return <section className="page-enter" data-testid="status-category-not-found"><h1 className="font-display text-3xl font-semibold">This category isn’t here.</h1><Link href="/categories" className="mt-5 inline-flex text-sm font-bold text-primary" data-testid="link-categories-from-empty-detail">Back to categories</Link></section>;
  return <div className="page-enter">
    <Link href="/categories" className="mb-7 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary" data-testid="link-back-categories"><ArrowLeft size={15} /> All categories</Link>
    <div className="flex flex-col gap-5 border-b border-border/80 pb-7 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-4"><div className="mt-1 grid size-12 shrink-0 place-items-center rounded-[16px]" style={{ color: category.color, backgroundColor: `${category.color}1B` }} data-testid="icon-category-detail"><CategoryIcon name={category.icon} /></div><div className="min-w-0"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">CATEGORY OVERVIEW</div><h1 className="break-words font-display text-[34px] font-semibold leading-tight tracking-[-.055em] sm:text-[44px]" data-testid="heading-category-detail">{category.name}</h1><p className="mt-2 max-w-[580px] text-sm leading-6 text-muted-foreground">{category.status === 'archived' ? 'Archived category · its history remains here.' : 'Your spending in this category, gathered in one place.'}</p></div></div>
      <div className="flex gap-2 sm:pt-1"><Button variant="outline" onClick={() => setFormOpen(true)} className="gap-2 rounded-xl" data-testid="button-edit-category-detail"><Pencil size={14} /> Edit</Button>{category.status === 'active' && <Button variant="outline" onClick={() => setConfirmArchive(true)} className="gap-2 rounded-xl" data-testid="button-archive-category-detail"><Archive size={14} /> Archive</Button>}</div>
    </div>
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <section className="relative overflow-hidden rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="card-category-total-spent"><div className="absolute -right-6 -top-8 size-32 rounded-full border border-primary/10" /><div className="absolute -right-1 -top-2 size-20 rounded-full border border-primary/10" /><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground"><CircleDollarSign size={15} className="text-primary" /> Total spent</div><p className="mt-5 font-display text-[36px] font-semibold leading-none tracking-[-.06em] sm:text-[42px]" data-testid="text-category-total-spent">{formatTotals(detail.totals)}</p><p className="mt-2 text-xs text-muted-foreground">Across all expenses in this category</p></section>
      <section className="rounded-[22px] border border-border/70 bg-secondary/50 p-5 sm:p-6" data-testid="card-category-expense-count"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground"><Wallet size={15} className="text-primary" /> Expenses</div><p className="mt-5 font-display text-[36px] font-semibold leading-none tracking-[-.06em] sm:text-[42px]" data-testid="text-category-expense-count">{detail.expenseCount}</p><p className="mt-2 text-xs text-muted-foreground">{detail.expenseCount === 1 ? 'expense in this category' : 'expenses in this category'}</p></section>
    </div>
    <div className="mt-7 grid gap-6 lg:grid-cols-[.88fr_1.12fr]">
      <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-category-monthly-spending"><div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-[19px] font-semibold tracking-[-.035em]">Monthly spending</h2><p className="mt-1 text-xs text-muted-foreground">Six months, including this one.</p></div><CircleDollarSign size={17} className="mt-1 text-primary" /></div>
        {detail.monthlySpending.length ? <div className="mt-7 flex h-[210px] items-end justify-between gap-2 border-b border-border/70 pb-3" data-testid="chart-category-monthly-spending">{detail.monthlySpending.map((month) => { const value = month.totals.reduce((sum, entry) => sum + Number(entry.total), 0); const height = value > 0 ? Math.max((value / maxSpend) * 100, 5) : 3; const labelDate = new Date(`${month.month}-01T12:00:00`); const label = Number.isNaN(labelDate.getTime()) ? month.month : new Intl.DateTimeFormat(undefined, { month: 'short' }).format(labelDate); return <div key={month.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2" data-testid={`bar-category-month-${month.month}`}><span className="text-[9px] tabular-nums text-muted-foreground">{value ? money(value) : '—'}</span><div className="flex h-[118px] w-full items-end justify-center"><div className="w-full max-w-10 rounded-t-md transition-[height] duration-300" style={{ height: `${height}%`, backgroundColor: category.color, opacity: value ? 0.85 : 0.2 }} /></div><span className="text-[10px] font-semibold text-muted-foreground">{label}</span></div>; })}</div> : <div className="mt-6 rounded-xl bg-secondary/45 px-4 py-7 text-center text-sm text-muted-foreground" data-testid="status-category-monthly-empty">Monthly totals will appear here as spending is recorded.</div>}
        {detail.monthlySpending.length > 0 && <div className="mt-4 space-y-2">{detail.monthlySpending.map((month) => <div key={month.month} className="flex items-center justify-between text-[11px] text-muted-foreground"><span>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${month.month}-01T12:00:00`))}</span><span>{month.expenseCount} {month.expenseCount === 1 ? 'expense' : 'expenses'}</span></div>)}</div>}
      </section>
      <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-category-recent-expenses"><div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-[19px] font-semibold tracking-[-.035em]">Recent expenses</h2><p className="mt-1 text-xs text-muted-foreground">The latest entries in this category.</p></div><span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold text-secondary-foreground" data-testid="text-category-recent-count">{detail.recentExpenses.length} recent</span></div>
        {detail.recentExpenses.length ? <div className="mt-4 divide-y divide-border/70" data-testid="list-category-recent-expenses">{detail.recentExpenses.map((expense) => <div key={expense.id} className="flex items-center gap-3 py-3.5" data-testid={`row-category-expense-${expense.id}`}><div className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${category.color}1B`, color: category.color }}><CategoryIcon name={category.icon} size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold" data-testid={`text-category-expense-description-${expense.id}`}>{expense.description || category.name}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{dateLabel(expense.date)}</p></div><p className="shrink-0 text-[13px] font-semibold tabular-nums" data-testid={`text-category-expense-amount-${expense.id}`}>{money(expense.amount)}</p></div>)}</div> : <div className="mt-5 rounded-xl bg-secondary/45 px-4 py-7 text-center" data-testid="status-category-expenses-empty"><p className="font-display text-base font-semibold">No expenses just yet</p><p className="mt-1.5 text-xs leading-5 text-muted-foreground">When spending is added to this category, it will show up here.</p></div>}
      </section>
    </div>
    <CategoryFormDialog key={`${formOpen ? 'open' : 'closed'}-${category.id}`} open={formOpen} onOpenChange={setFormOpen} category={category} />
    <ArchiveConfirmation category={category} open={confirmArchive} onOpenChange={setConfirmArchive} />
  </div>;
}