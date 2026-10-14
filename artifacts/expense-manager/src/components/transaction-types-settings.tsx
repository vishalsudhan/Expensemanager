import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, Check, Plus, RotateCcw, SlidersHorizontal, Trash2, X } from 'lucide-react';
import {
  getListTransactionTypesQueryKey, useCreateTransactionType, useListTransactionTypes,
  useUpdateTransactionType,
} from '@workspace/api-client-react';
import type { TransactionType } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { errorText } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

const KIND_COPY: Record<string, { label: string; hint: string }> = {
  expense: {
    label: 'Expense',
    hint: 'Counts as spending.',
  },
  payment: {
    label: 'Payment',
    hint: 'Settles a debt, so it stays out of spending totals.',
  },
};

/**
 * Lets the reader name their own transaction types.
 *
 * The type is picked from a list, never typed free-hand, because the kind is
 * what decides whether a row counts as spending. A type that had no kind would
 * fall outside every total in the app, so it has to be chosen deliberately.
 */
export function TransactionTypesSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'expense' | 'payment'>('expense');
  const [renamingId, setRenamingId] = useState('');
  const [renameValue, setRenameValue] = useState('');

  const query = useListTransactionTypes({ status: 'all' });
  const create = useCreateTransactionType();
  const update = useUpdateTransactionType();

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListTransactionTypesQueryKey() });

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { data: { name: trimmed, kind } },
      {
        onSuccess: async (created) => {
          await refresh();
          setName('');
          toast({
            title: `${created.name} added`,
            description:
              created.kind === 'expense'
                ? 'It will count as spending.'
                : 'It will stay out of spending totals.',
          });
        },
        onError: (error) =>
          toast({ title: 'Could not add the type', description: errorText(error), variant: 'destructive' }),
      },
    );
  };

  const startRename = (type: TransactionType) => {
    setRenamingId(type.id);
    setRenameValue(type.name);
  };

  const saveRename = (id: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    update.mutate(
      { transactionTypeId: id, data: { name: trimmed } },
      {
        onSuccess: async () => {
          await refresh();
          setRenamingId('');
          toast({ title: 'Type renamed', description: 'Expenses already recorded against it are untouched.' });
        },
        onError: (error) =>
          toast({ title: 'Could not rename the type', description: errorText(error), variant: 'destructive' }),
      },
    );
  };

  const toggleStatus = (type: TransactionType) => {
    const archiving = type.status === 'active';
    update.mutate(
      { transactionTypeId: type.id, data: { status: archiving ? 'archived' : 'active' } },
      {
        onSuccess: async () => {
          await refresh();
          toast({
            title: archiving ? 'Type archived' : 'Type restored',
            description: archiving
              ? 'It is hidden from pickers. Existing expenses still count as before.'
              : 'It is available again.',
          });
        },
        onError: (error) =>
          toast({ title: 'Could not update the type', description: errorText(error), variant: 'destructive' }),
      },
    );
  };

  const rows = (query.data ?? []).filter((type) => type.status === status);

  return (
    <section className="mt-8 max-w-[760px]" data-testid="section-transaction-types">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-full bg-accent/70 text-accent-foreground">
          <ArrowDownUp size={18} strokeWidth={1.8} />
        </div>
        <div>
          <h2 className="font-display text-[19px] font-semibold tracking-[-0.03em]" data-testid="heading-transaction-types">
            Transaction types
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Name the kinds of transaction you record. Each type is an expense or a payment, and that choice
            decides whether it counts towards your spending.
          </p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-[20px] border border-border/70 bg-card">
        <div className="flex gap-1 border-b border-border/60 px-3 py-2">
          {(['active', 'archived'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={status === tab}
              onClick={() => setStatus(tab)}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-bold capitalize transition-colors ${status === tab ? 'bg-secondary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              data-testid={`button-transaction-types-${tab}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {query.isLoading ? (
          <div className="space-y-2 p-4" data-testid="status-transaction-types-loading">
            {[0, 1].map((row) => <Skeleton key={row} className="h-14 rounded-xl" />)}
          </div>
        ) : query.isError ? (
          <div className="px-5 py-8 text-center" data-testid="status-transaction-types-error">
            <p className="text-sm text-muted-foreground">Transaction types couldn’t be loaded.</p>
            <Button onClick={() => query.refetch()} variant="outline" className="mt-4 gap-2" data-testid="button-retry-transaction-types">
              <RotateCcw size={14} /> Try again
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border/60" data-testid="list-transaction-types">
            {rows.map((type) => (
              <li key={type.id} className="flex items-center justify-between gap-4 px-5 py-3.5" data-testid={`row-transaction-type-${type.slug}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-[13px] ${type.kind === 'expense' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                    aria-hidden="true"
                  >
                    <SlidersHorizontal size={16} />
                  </span>
                  <div className="min-w-0">
                    {renamingId === type.id ? (
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') { event.preventDefault(); saveRename(type.id); }
                          if (event.key === 'Escape') setRenamingId('');
                        }}
                        className="h-9 w-[200px] rounded-xl text-[13px]"
                        aria-label={`Rename ${type.name}`}
                        data-testid={`input-rename-transaction-type-${type.slug}`}
                      />
                    ) : (
                      <p className="font-display text-[15px] font-semibold tracking-[-0.02em]" data-testid={`text-transaction-type-${type.slug}`}>
                        {type.name}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {KIND_COPY[type.kind]?.label ?? type.kind} · {KIND_COPY[type.kind]?.hint}{' '}
                      <span className="tabular-nums">
                        {type.expenseCount} expense{type.expenseCount === 1 ? '' : 's'}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {renamingId === type.id ? (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={update.isPending || !renameValue.trim()}
                        onClick={() => saveRename(type.id)}
                        className="size-9 rounded-xl"
                        aria-label="Save name"
                        data-testid={`button-save-transaction-type-${type.slug}`}
                      >
                        <Check size={15} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setRenamingId('')}
                        className="size-9 rounded-xl"
                        aria-label="Cancel rename"
                        data-testid={`button-cancel-transaction-type-${type.slug}`}
                      >
                        <X size={15} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        disabled={update.isPending}
                        onClick={() => toggleStatus(type)}
                        className="h-9 rounded-xl px-3 text-[11px]"
                        data-testid={`button-toggle-transaction-type-${type.slug}`}
                      >
                        {type.status === 'active' ? 'Archive' : 'Restore'}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => startRename(type)}
                        className="size-9 rounded-xl"
                        aria-label={`Rename ${type.name}`}
                        data-testid={`button-rename-transaction-type-${type.slug}`}
                      >
                        <ArrowDownUp size={15} className="rotate-90" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
            {!rows.length && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground" data-testid="status-transaction-types-empty">
                {status === 'active' ? 'No active types.' : 'Nothing archived.'}
              </li>
            )}
          </ul>
        )}
      </div>

      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Card payment"
          aria-label="New transaction type name"
          className="h-10 w-[220px] rounded-xl text-sm"
          data-testid="input-new-transaction-type"
        />
        <div className="flex gap-1 rounded-xl bg-secondary/65 p-1" role="group" aria-label="Kind of the new type">
          {(['expense', 'payment'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
              title={KIND_COPY[option].hint}
              className={`min-h-8 rounded-lg px-3 text-[11px] font-bold transition-colors ${kind === option ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              data-testid={`button-new-transaction-type-kind-${option}`}
            >
              {KIND_COPY[option].label}
            </button>
          ))}
        </div>
        <Button type="submit" disabled={create.isPending || !name.trim()} className="h-10 gap-2 rounded-xl px-4" data-testid="button-add-transaction-type">
          <Plus size={15} /> Add type
        </Button>
      </form>
    </section>
  );
}