import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  Archive, Check, Hash, LoaderCircle, Pencil, Plus, RotateCcw, Search,
} from 'lucide-react';
import {
  getListLabelsQueryKey, useArchiveLabel, useCreateLabel, useListLabels, useUpdateLabel,
} from '@workspace/api-client-react';
import type { Label, LabelInput, LabelUpdate, ListLabelsParams } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
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

const colors = ['#C27C68', '#47796A', '#66869A', '#9C8050', '#7D7397', '#71834E', '#C16D61', '#5C7D84'];
const formSchema = z.object({
  name: z.string().trim().min(1, 'Give this label a name.').max(80, 'Keep the name under 80 characters.'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a valid color.'),
});
type FormValues = z.infer<typeof formSchema>;

const errorText = (error: unknown) => {
  if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') return error.error;
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
};

function LabelFormDialog({ open, onOpenChange, label }: {
  open: boolean; onOpenChange: (open: boolean) => void; label?: Label | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const editing = Boolean(label);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: label?.name ?? '', color: label?.color ?? colors[0] },
  });
  const busy = createLabel.isPending || updateLabel.isPending;

  const submit = (values: FormValues) => {
    if (label) {
      const data: LabelUpdate = { name: values.name, color: values.color };
      updateLabel.mutate({ labelId: label.id, data }, {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getListLabelsQueryKey() });
          toast({ title: 'Label updated', description: 'Your changes are saved.' });
          onOpenChange(false);
        },
        onError: (error) => toast({
          title: 'Could not update label',
          description: errorText(error),
          variant: 'destructive',
        }),
      });
      return;
    }

    const data: LabelInput = { name: values.name, color: values.color };
    createLabel.mutate({ data }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListLabelsQueryKey() });
        toast({ title: 'Label created', description: `${values.name} is ready to use.` });
        onOpenChange(false);
      },
      onError: (error) => toast({
        title: 'Could not create label',
        description: /duplicate|already exists|unique/i.test(errorText(error))
          ? 'A label with this name already exists. Try a different name.'
          : errorText(error),
        variant: 'destructive',
      }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px] rounded-[24px] border-border bg-card p-6 sm:p-8" data-testid="dialog-label-form">
        <DialogHeader>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">{editing ? 'MAKE IT YOURS' : 'A USEFUL LITTLE TAG'}</p>
          <DialogTitle className="font-display text-2xl tracking-[-.04em]">{editing ? 'Edit label' : 'Create a label'}</DialogTitle>
          <DialogDescription className="leading-6">Labels are global tags you can combine to describe an expense.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="mt-2 space-y-5" data-testid="form-label">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Label name</FormLabel>
                <FormControl>
                  <Input {...field} autoFocus maxLength={80} placeholder="e.g. Reimbursable" className="h-11 rounded-xl bg-background" data-testid="input-label-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="color" render={({ field }) => (
              <FormItem>
                <FormLabel>Color</FormLabel>
                <FormControl>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Label color" data-testid="group-label-colors">
                    {colors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Choose ${color} label color`}
                        aria-pressed={field.value === color}
                        onClick={() => field.onChange(color)}
                        className="grid size-9 place-items-center rounded-full border-2 transition-transform hover:scale-105"
                        style={{ borderColor: field.value === color ? color : 'transparent' }}
                        data-testid={`button-label-color-${color.slice(1)}`}
                      >
                        <span className="grid size-6 place-items-center rounded-full" style={{ backgroundColor: color }}>
                          {field.value === color && <Check size={15} className="text-white" />}
                        </span>
                      </button>
                    ))}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-label">Cancel</Button>
              <Button type="submit" disabled={busy} className="gap-2" data-testid="button-save-label">
                {busy && <LoaderCircle size={15} className="animate-spin" />}
                {editing ? 'Save changes' : 'Create label'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveConfirmation({ label, open, onOpenChange }: {
  label: Label | null; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const archive = useArchiveLabel();

  const confirm = () => {
    if (!label) return;
    archive.mutate({ labelId: label.id }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListLabelsQueryKey() });
        toast({ title: 'Label archived', description: `${label.name} is now in your archive.` });
        onOpenChange(false);
      },
      onError: (error) => toast({
        title: 'Could not archive label',
        description: errorText(error),
        variant: 'destructive',
      }),
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(value) => { if (!value && !archive.isPending) onOpenChange(false); }}>
      <AlertDialogContent className="rounded-[22px] border-border bg-card" data-testid="dialog-archive-label">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl tracking-[-.03em]">Archive {label?.name}?</AlertDialogTitle>
          <AlertDialogDescription>Archiving keeps the label in your records but removes it from the active label list.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={archive.isPending} data-testid="button-cancel-archive-label">Keep label</AlertDialogCancel>
          <AlertDialogAction
            disabled={archive.isPending}
            onClick={(event) => { event.preventDefault(); confirm(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-archive-label"
          >
            {archive.isPending ? 'Archiving…' : 'Archive label'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function LabelListPage() {
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Label | null>(null);
  const [archiving, setArchiving] = useState<Label | null>(null);
  const params: ListLabelsParams = { status, ...(search.trim() ? { search: search.trim() } : {}) };
  const query = useListLabels(params);
  const openForm = (label: Label | null = null) => { setEditing(label); setFormOpen(true); };

  return (
    <div className="page-enter">
      <div className="mb-7 text-[10px] font-bold uppercase tracking-[.19em] text-primary">YOUR OWN WAY</div>
      <div className="flex flex-col gap-5 border-b border-border/80 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-[40px] font-semibold leading-none tracking-[-.055em] sm:text-[52px]" data-testid="heading-labels">Labels</h1>
          <p className="mt-4 max-w-[470px] text-[14px] leading-6 text-muted-foreground">Add flexible tags to describe the details that matter across your spending.</p>
        </div>
        <Button onClick={() => openForm()} className="h-11 gap-2 rounded-xl px-4" data-testid="button-new-label"><Plus size={16} /> New label</Button>
      </div>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-[340px]">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a label" aria-label="Search labels" className="h-11 rounded-xl bg-card pl-10" data-testid="input-search-labels" />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex rounded-xl bg-secondary/65 p-1" role="tablist" aria-label="Label status">
            {(['active', 'archived'] as const).map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={status === tab} onClick={() => setStatus(tab)} data-testid={`tab-labels-${tab}`} className={`min-h-9 rounded-lg px-4 text-xs font-bold capitalize transition-colors ${status === tab ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{tab}</button>
            ))}
          </div>
          {!query.isLoading && !query.isError && <span className="hidden text-xs text-muted-foreground sm:inline" data-testid="text-label-count">{query.data?.length ?? 0} {status}</span>}
        </div>
      </div>

      {query.isLoading ? (
        <div className="mt-5 space-y-3" aria-label="Loading labels" data-testid="status-labels-loading">
          {[0, 1, 2].map((n) => <div key={n} className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card p-5"><Skeleton className="size-10 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-52" /></div><Skeleton className="h-8 w-20" /></div>)}
        </div>
      ) : query.isError ? (
        <section className="mt-6 rounded-[22px] border border-destructive/25 bg-card px-6 py-9 text-center" data-testid="status-labels-error">
          <p className="font-display text-xl font-semibold">Your labels didn’t load.</p>
          <p className="mt-2 text-sm text-muted-foreground">{errorText(query.error)}</p>
          <Button onClick={() => query.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-labels"><RotateCcw size={15} /> Try again</Button>
        </section>
      ) : query.data?.length ? (
        <div className="mt-5 space-y-3" data-testid="list-labels">
          {query.data.map((label) => (
            <article key={label.id} className="flex flex-col gap-4 rounded-[20px] border border-border/70 bg-card px-4 py-4 transition-all hover:border-primary/25 hover:shadow-[0_12px_36px_-30px_hsl(163_18%_19%/.4)] sm:flex-row sm:items-center sm:px-5" data-testid={`card-label-${label.id}`}>
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${label.color}1B`, color: label.color }} aria-hidden="true"><Hash size={17} strokeWidth={1.8} /></div>
                <div className="min-w-0">
                  <p className="truncate font-display text-[17px] font-semibold tracking-[-.025em]" data-testid={`text-label-name-${label.id}`}>{label.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{label.status === 'archived' ? 'Archived label' : 'Global label'}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3 sm:justify-end sm:border-0 sm:pt-0">
                <span className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground" data-testid={`badge-label-color-${label.id}`}>
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: label.color }} />
                  {label.color.toUpperCase()}
                </span>
                {status === 'active' ? (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => openForm(label)} aria-label={`Edit ${label.name}`} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary" data-testid={`button-edit-label-${label.id}`}><Pencil size={15} /></button>
                    <button type="button" onClick={() => setArchiving(label)} aria-label={`Archive ${label.name}`} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground" data-testid={`button-archive-label-${label.id}`}><Archive size={15} /></button>
                  </div>
                ) : (
                  <Badge variant="secondary" className="gap-1.5 rounded-full px-2.5 py-1 text-[10px] capitalize"><Archive size={12} /> Archived</Badge>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="mt-6 rounded-[24px] border border-dashed border-border bg-card/55 px-6 py-12 text-center sm:py-16" data-testid="status-labels-empty">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><Hash size={21} /></div>
          <p className="mt-5 font-display text-[23px] font-semibold tracking-[-.04em]">{search ? 'No label found.' : status === 'active' ? 'Start with a few tags.' : 'Your archive is quiet.'}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{search ? 'Try another search, or clear it to see every label.' : status === 'active' ? 'Create labels such as Personal, Family, or Reimbursable to add useful context to spending.' : 'Archived labels stay here so older records keep their context.'}</p>
          {status === 'active' && !search && <Button onClick={() => openForm()} className="mt-6 gap-2" data-testid="button-create-first-label"><Plus size={16} /> Create your first label</Button>}
        </section>
      )}

      <LabelFormDialog key={`${formOpen ? 'open' : 'closed'}-${editing?.id ?? 'new'}`} open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }} label={editing} />
      <ArchiveConfirmation label={archiving} open={Boolean(archiving)} onOpenChange={(open) => { if (!open) setArchiving(null); }} />
    </div>
  );
}