import { useEffect, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Check, HandCoins, LoaderCircle, Plus, X } from 'lucide-react';
import type { ExpenseSettlementType } from '@workspace/api-client-react';
import { useCounterparties } from '@/hooks/use-counterparties';
import { useToast } from '@/hooks/use-toast';
import { errorText } from '@/lib/format';
import {
  counterpartyQuestion,
  localToday,
  settledVerb,
  settlementTypeOptions,
  statusOptions,
} from '@/lib/settlements';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

/** The subset of the expense form this section reads and writes. */
export type SettlementFormValues = {
  transactionType: 'expense' | 'payment';
  settlementType: ExpenseSettlementType;
  counterpartyId: string;
  settlementStatus: 'pending' | 'claimed' | 'settled';
  settledOn: string;
};

const selectClass =
  'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring';
const NEW_OPTION = '__new__';

export function SettlementFields({ projectDefaultCounterpartyId }: { projectDefaultCounterpartyId?: string | null }) {
  const form = useFormContext<SettlementFormValues>();
  const { toast } = useToast();
  const { counterparties, isLoading, createCounterparty, creating } = useCounterparties();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const transactionType = useWatch({ control: form.control, name: 'transactionType' });
  const settlementType = useWatch({ control: form.control, name: 'settlementType' });
  const settlementStatus = useWatch({ control: form.control, name: 'settlementStatus' });
  const counterpartyId = useWatch({ control: form.control, name: 'counterpartyId' });
  const isPayment = transactionType === 'payment';
  const active = settlementType !== 'none' && !isPayment;

  // A bill payment settles a debt; it can't itself be reimbursable.
  useEffect(() => {
    if (isPayment && form.getValues('settlementType') !== 'none') {
      form.setValue('settlementType', 'none');
    }
  }, [isPayment, form]);

  // "Claimed" only exists for reimbursements.
  useEffect(() => {
    if (settlementType === 'paid_by_other' && settlementStatus === 'claimed') {
      form.setValue('settlementStatus', 'pending');
    }
  }, [settlementType, settlementStatus, form]);

  // The project's usual reimburser is a suggestion, never an override.
  useEffect(() => {
    if (settlementType === 'reimbursable' && !counterpartyId && projectDefaultCounterpartyId) {
      form.setValue('counterpartyId', projectDefaultCounterpartyId);
    }
  }, [settlementType, counterpartyId, projectDefaultCounterpartyId, form]);

  const chooseType = (value: ExpenseSettlementType) => {
    form.setValue('settlementType', value, { shouldDirty: true });
    form.clearErrors(['counterpartyId', 'settledOn']);
  };

  const addCounterparty = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createCounterparty(name);
      form.setValue('counterpartyId', created.id, { shouldValidate: true, shouldDirty: true });
      setAdding(false);
      setNewName('');
    } catch (error) {
      toast({ title: 'Could not add', description: errorText(error), variant: 'destructive' });
    }
  };

  return (
    <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-7" data-testid="section-expense-settlement">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary"><HandCoins size={17} /></span>
        <div>
          <h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">Who paid?</h2>
          <p className="text-xs text-muted-foreground">Track money that should come back to you, or that you owe.</p>
        </div>
      </div>

      {isPayment ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground" data-testid="text-settlement-payment-note">
          Bill payments settle a debt, so they can’t be reimbursable. Switch the type to Expense to use this.
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Who paid?">
            {settlementTypeOptions.map((option) => {
              const selected = settlementType === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => chooseType(option.value)}
                  className={`flex min-h-[60px] items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-left transition-colors ${
                    selected ? 'border-primary/45 bg-secondary text-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/30'
                  }`}
                  data-testid={`button-settlement-type-${option.value}`}
                >
                  <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'}`}>
                    {selected && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span>
                    <span className={`block text-[13px] font-semibold ${selected ? 'text-foreground' : ''}`}>{option.label}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{option.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {active && (
            <div className="mt-5 grid gap-5 border-t border-border/70 pt-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="counterpartyId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{counterpartyQuestion(settlementType)} <span className="text-destructive">*</span></FormLabel>
                    {adding ? (
                      <div className="flex gap-2">
                        <Input
                          autoFocus
                          value={newName}
                          maxLength={80}
                          onChange={(event) => setNewName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void addCounterparty();
                            }
                            if (event.key === 'Escape') setAdding(false);
                          }}
                          placeholder="Name of person or company"
                          className="h-11 rounded-xl bg-background"
                          data-testid="input-new-counterparty"
                        />
                        <Button type="button" onClick={() => void addCounterparty()} disabled={creating || !newName.trim()} className="h-11 rounded-xl px-3" data-testid="button-save-new-counterparty">
                          {creating ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}
                          <span className="sr-only sm:not-sr-only">Add</span>
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setAdding(false)} className="h-11 rounded-xl px-2.5" aria-label="Cancel adding">
                          <X size={15} />
                        </Button>
                      </div>
                    ) : (
                      <FormControl>
                        <select
                          {...field}
                          onChange={(event) => {
                            if (event.target.value === NEW_OPTION) {
                              setAdding(true);
                              return;
                            }
                            field.onChange(event);
                          }}
                          disabled={isLoading}
                          className={selectClass}
                          data-testid="select-expense-counterparty"
                        >
                          <option value="">{isLoading ? 'Loading…' : 'Choose a person or company'}</option>
                          {counterparties.map((counterparty) => (
                            <option key={counterparty.id} value={counterparty.id}>{counterparty.name}</option>
                          ))}
                          <option value={NEW_OPTION}>+ Add someone new…</option>
                        </select>
                      </FormControl>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="settlementStatus"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        onChange={(event) => {
                          field.onChange(event);
                          if (event.target.value === 'settled' && !form.getValues('settledOn')) {
                            form.setValue('settledOn', localToday());
                          }
                        }}
                        className={selectClass}
                        data-testid="select-expense-settlement-status"
                      >
                        {statusOptions(settlementType).map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {settlementStatus === 'settled' && (
                <FormField
                  control={form.control}
                  name="settledOn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{settledVerb(settlementType)} on <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} type="date" max={localToday()} className="h-11 rounded-xl bg-background" data-testid="input-expense-settled-on" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <p className="text-[11px] leading-5 text-muted-foreground sm:col-span-2" data-testid="text-settlement-hint">
                {settlementType === 'reimbursable'
                  ? 'Still counts in this month’s spending, shown as reimbursable. When the money comes back it’s recorded on the day it arrives, so this month never changes.'
                  : 'It’s still your expense for this month. Mark it paid back when you settle up; that’s recorded on the day you pay.'}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
