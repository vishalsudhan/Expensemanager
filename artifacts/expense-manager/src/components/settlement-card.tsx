import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { CalendarCheck, HandCoins, LoaderCircle, RotateCcw, Send } from 'lucide-react';
import {
  getGetDashboardQueryKey,
  getGetExpenseQueryKey,
  getGetSettlementReportQueryKey,
  getListExpensesQueryKey,
  useUpdateExpenseSettlement,
} from '@workspace/api-client-react';
import type { ExpenseRecord, ExpenseSettlementStatus } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useOffline } from '@/components/offline-provider';
import { errorText, formatDate, money } from '@/lib/format';
import { localToday, settledVerb, statusLabel, statusTone } from '@/lib/settlements';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Settlement status and the next step for a reimbursable or paid-by-someone-else expense. */
export function SettlementCard({ expense }: { expense: ExpenseRecord }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { online } = useOffline();
  const update = useUpdateExpenseSettlement();
  const [confirming, setConfirming] = useState(false);
  const [settledOn, setSettledOn] = useState(localToday());

  if (expense.settlementType === 'none' || !expense.counterparty) return null;

  const type = expense.settlementType;
  const status = expense.settlementStatus;
  const name = expense.counterparty.name;
  const reimbursable = type === 'reimbursable';
  const verb = settledVerb(type);

  const move = (next: ExpenseSettlementStatus, date?: string) => {
    if (!online) {
      toast({ title: 'You’re offline', description: 'Reconnect to update this.', variant: 'destructive' });
      return;
    }
    update.mutate(
      { expenseId: expense.id, data: { status: next, settledOn: date ?? null } },
      {
        onSuccess: async () => {
          setConfirming(false);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getGetExpenseQueryKey(expense.id) }),
            queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetSettlementReportQueryKey() }),
          ]);
          toast({
            title:
              next === 'settled'
                ? reimbursable ? 'Marked as received' : 'Marked as paid back'
                : next === 'claimed' ? 'Marked as claimed' : 'Reopened',
            description: next === 'settled' ? `Recorded on ${formatDate(date ?? localToday())}. This expense’s month is unchanged.` : undefined,
          });
        },
        onError: (error) => toast({ title: 'Could not update', description: errorText(error), variant: 'destructive' }),
      },
    );
  };

  const headline =
    status === 'settled'
      ? reimbursable
        ? `${name} paid you back`
        : `You paid ${name} back`
      : reimbursable
        ? `${name} owes you`
        : `You owe ${name}`;

  return (
    <section className="mt-5 rounded-[22px] border border-border/70 bg-card p-5 sm:p-7" data-testid="section-expense-settlement-detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><HandCoins size={16} /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">{reimbursable ? 'Reimbursable' : 'Paid by someone else'}</p>
            <h2 className="mt-1 font-display text-[19px] font-semibold tracking-[-.03em]" data-testid="text-settlement-headline">
              {headline} <span className="tabular-nums">{money(expense.amount, expense.currency)}</span>
            </h2>
            <p className="mt-1 text-xs text-muted-foreground" data-testid="text-settlement-when">
              {status === 'settled' && expense.settledOn
                ? `${verb} on ${formatDate(expense.settledOn)} · spent on ${formatDate(expense.date)}`
                : `Since ${formatDate(expense.date)}`}
            </p>
          </div>
        </div>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusTone(status)}`} data-testid="badge-settlement-status">
          {statusLabel(type, status)}
        </span>
      </div>

      {confirming ? (
        <div className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">{verb} on</span>
            <Input type="date" value={settledOn} max={localToday()} onChange={(event) => setSettledOn(event.target.value)} className="h-11 rounded-xl bg-background" data-testid="input-settle-date" />
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)} className="h-11 rounded-xl" data-testid="button-cancel-settle">Cancel</Button>
            <Button onClick={() => move('settled', settledOn)} disabled={update.isPending || !settledOn} className="h-11 gap-2 rounded-xl" data-testid="button-confirm-settle">
              {update.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <CalendarCheck size={15} />} Confirm
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border/70 pt-5">
          {status !== 'settled' && (
            <Button onClick={() => { setSettledOn(localToday()); setConfirming(true); }} className="h-10 gap-2 rounded-xl text-xs font-bold" data-testid="button-mark-settled">
              <CalendarCheck size={14} /> {reimbursable ? 'Mark as received' : 'Mark as paid back'}
            </Button>
          )}
          {reimbursable && status === 'pending' && (
            <Button variant="outline" onClick={() => move('claimed')} disabled={update.isPending} className="h-10 gap-2 rounded-xl text-xs font-bold" data-testid="button-mark-claimed">
              <Send size={14} /> Mark as claimed
            </Button>
          )}
          {(status === 'settled' || status === 'claimed') && (
            <Button variant="outline" onClick={() => move('pending')} disabled={update.isPending} className="h-10 gap-2 rounded-xl text-xs font-bold" data-testid="button-reopen-settlement">
              <RotateCcw size={14} /> {status === 'settled' ? 'Reopen' : 'Back to pending'}
            </Button>
          )}
          <Link
            href={`/expenses?counterpartyId=${expense.counterparty.id}&settlementStatus=open`}
            className="inline-flex h-10 items-center px-2 text-xs font-bold text-primary hover:underline"
            data-testid="link-settlement-counterparty"
          >
            Everything open with {name}
          </Link>
        </div>
      )}
    </section>
  );
}
