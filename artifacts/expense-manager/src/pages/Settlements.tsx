import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Archive, ArrowDownLeft, ArrowUpRight, Check, ChevronRight, CircleAlert, HandCoins, LoaderCircle,
  Pencil, Plus, RotateCcw, Users, X,
} from 'lucide-react';
import {
  getListCounterpartiesQueryKey,
  useGetSettlementReport,
  useListCounterparties,
  useUpdateCounterparty,
} from '@workspace/api-client-react';
import type { Counterparty, SettlementPartyRow, SettlementSide } from '@workspace/api-client-react';
import { useCounterparties } from '@/hooks/use-counterparties';
import { useToast } from '@/hooks/use-toast';
import { errorText, formatMonth, formatTotals, money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

type Direction = 'owed' | 'owing';

function ageLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  if (days < 60) return `${days} days`;
  return `${Math.round(days / 30)} months`;
}

/** One line per currency, so mixed currencies never run together on a phone. */
function Amounts({ totals }: { totals: SettlementSide['totals'] }) {
  if (!totals.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-end gap-0.5">
      {totals.map((entry) => <span key={entry.currency.id} className="whitespace-nowrap">{money(entry.total, entry.currency)}</span>)}
    </span>
  );
}

function BalanceCard({ direction, side, active, onSelect }: {
  direction: Direction; side: SettlementSide; active: boolean; onSelect: () => void;
}) {
  const owed = direction === 'owed';
  const count = side.parties.reduce((sum, party) => sum + party.count, 0);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`relative overflow-hidden rounded-[24px] border p-5 text-left transition-all sm:p-6 ${
        active ? 'border-primary/40 bg-card shadow-[0_18px_44px_-34px_var(--hover-shadow)]' : 'border-border/70 bg-card/70 hover:border-primary/25'
      }`}
      data-testid={`card-balance-${direction}`}
    >
      <div className="flex items-center gap-2">
        <span className={`grid size-8 place-items-center rounded-xl ${owed ? 'bg-secondary text-primary' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
          {owed ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
        </span>
        <p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">{owed ? 'Owed to you' : 'You owe'}</p>
      </div>
      <p className="mt-4 font-display text-[30px] font-semibold leading-none tracking-[-.055em] tabular-nums sm:text-[36px]" data-testid={`text-balance-${direction}`}>
        {side.totals.length ? formatTotals(side.totals) : '—'}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {count === 0
          ? owed ? 'Nothing waiting to come back.' : 'You’re all square.'
          : `${count} ${count === 1 ? 'expense' : 'expenses'} · ${side.parties.length} ${side.parties.length === 1 ? (owed ? 'payer' : 'person') : (owed ? 'payers' : 'people')}`}
      </p>
      {active && <span className="absolute right-5 top-5 size-1.5 rounded-full bg-primary" />}
    </button>
  );
}

function PartyRow({ party, direction }: { party: SettlementPartyRow; direction: Direction }) {
  const type = direction === 'owed' ? 'reimbursable' : 'paid_by_other';
  const stale = party.oldestDays >= 30;
  return (
    <Link
      href={`/expenses?counterpartyId=${party.counterparty.id}&settlementType=${type}&settlementStatus=open`}
      className="group flex min-w-0 items-center gap-3 rounded-[18px] border border-border/70 bg-card px-4 py-3.5 transition-all hover:-translate-y-0.5 hover:border-primary/25 sm:px-5"
      data-testid={`row-party-${direction}-${party.counterparty.id}`}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary font-display text-sm font-semibold text-primary">
        {party.counterparty.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[15px] font-semibold tracking-[-.02em]">{party.counterparty.name}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {party.count} {party.count === 1 ? 'expense' : 'expenses'}
          {party.claimedCount > 0 && <> · {party.claimedCount} claimed</>}
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span className={stale ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}>oldest {ageLabel(party.oldestDays)}</span>
        </p>
      </div>
      <p className="shrink-0 text-right font-display text-[15px] font-semibold tabular-nums">{formatTotals(party.totals)}</p>
      <ChevronRight size={16} className="shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  );
}

function PeopleManager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const all = useListCounterparties({ status: 'all' });
  const { createCounterparty, creating } = useCounterparties();
  const update = useUpdateCounterparty();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListCounterpartiesQueryKey() });
  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createCounterparty(name);
      setNewName('');
      toast({ title: 'Added', description: `${name} can now be chosen on expenses.` });
    } catch (error) {
      toast({ title: 'Could not add', description: errorText(error), variant: 'destructive' });
    }
  };
  const change = (item: Counterparty, data: { name?: string; status?: 'active' | 'archived' }, done: string) =>
    update.mutate({ counterpartyId: item.id, data }, {
      onSuccess: async () => {
        setEditing(null);
        await refresh();
        toast({ title: done });
      },
      onError: (error) => toast({ title: 'Could not save', description: errorText(error), variant: 'destructive' }),
    });

  const items = (all.data ?? []).filter((item) => (showArchived ? true : item.status === 'active'));
  const archivedCount = (all.data ?? []).filter((item) => item.status === 'archived').length;

  return (
    <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-people">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary"><Users size={16} /></span>
        <div>
          <h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">People & companies</h2>
          <p className="text-xs text-muted-foreground">One list for whoever reimburses you and whoever pays for you.</p>
        </div>
      </div>
      <form
        onSubmit={(event) => { event.preventDefault(); void add(); }}
        className="mt-5 flex gap-2"
      >
        <Input value={newName} maxLength={80} onChange={(event) => setNewName(event.target.value)} placeholder="Add a person or company" className="h-11 rounded-xl bg-background" data-testid="input-add-counterparty" />
        <Button type="submit" disabled={creating || !newName.trim()} className="h-11 gap-2 rounded-xl" data-testid="button-add-counterparty">
          {creating ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />} Add
        </Button>
      </form>
      {all.isLoading ? (
        <div className="mt-4 space-y-2"><Skeleton className="h-12 rounded-xl" /><Skeleton className="h-12 rounded-xl" /></div>
      ) : items.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No one yet. You can also add people right from the expense form.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border/70 rounded-2xl border border-border/70" data-testid="list-counterparties">
          {items.map((item) => (
            <li key={item.id} className="flex min-h-14 items-center gap-3 px-4 py-2" data-testid={`row-counterparty-${item.id}`}>
              {editing === item.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (editName.trim()) change(item, { name: editName.trim() }, 'Renamed');
                  }}
                >
                  <Input autoFocus value={editName} maxLength={80} onChange={(event) => setEditName(event.target.value)} className="h-10 rounded-xl bg-background" data-testid="input-rename-counterparty" />
                  <Button type="submit" size="icon" className="size-10 rounded-xl" aria-label="Save name" disabled={update.isPending}><Check size={15} /></Button>
                  <Button type="button" size="icon" variant="ghost" className="size-10 rounded-xl" aria-label="Cancel" onClick={() => setEditing(null)}><X size={15} /></Button>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${item.status === 'archived' ? 'text-muted-foreground line-through' : ''}`}>{item.name}</p>
                    <p className="text-[11px] text-muted-foreground">{item.usageCount ?? 0} {(item.usageCount ?? 0) === 1 ? 'expense' : 'expenses'}{item.status === 'archived' ? ' · archived' : ''}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="size-10 rounded-xl" aria-label={`Rename ${item.name}`} onClick={() => { setEditing(item.id); setEditName(item.name); }} data-testid={`button-rename-${item.id}`}><Pencil size={14} /></Button>
                  {item.status === 'active' ? (
                    <Button variant="ghost" size="icon" className="size-10 rounded-xl" aria-label={`Archive ${item.name}`} onClick={() => change(item, { status: 'archived' }, `${item.name} archived. Past expenses keep the name.`)} data-testid={`button-archive-${item.id}`}><Archive size={14} /></Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="size-10 rounded-xl" aria-label={`Restore ${item.name}`} onClick={() => change(item, { status: 'active' }, `${item.name} restored`)} data-testid={`button-restore-${item.id}`}><RotateCcw size={14} /></Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {archivedCount > 0 && (
        <button type="button" onClick={() => setShowArchived((value) => !value)} className="mt-3 text-[11px] font-bold text-primary hover:underline" data-testid="button-toggle-archived-counterparties">
          {showArchived ? 'Hide archived' : `Show ${archivedCount} archived`}
        </button>
      )}
    </section>
  );
}

export function SettlementsPage() {
  const report = useGetSettlementReport({ months: 6 });
  const [direction, setDirection] = useState<Direction>('owed');
  const data = report.data;
  const side = data ? (direction === 'owed' ? data.owedToMe : data.iOwe) : null;
  const movedMonths = (data?.monthly ?? []).filter((month) => month.received.length || month.repaid.length);

  return (
    <div className="page-enter">
      <p className="mb-7 text-[10px] font-bold uppercase tracking-[.19em] text-primary">MONEY IN MOTION</p>
      <header className="border-b border-border/80 pb-8">
        <h1 className="font-display text-[40px] font-semibold leading-none tracking-[-.055em] sm:text-[52px]" data-testid="heading-settlements">Owed & owing</h1>
        <p className="mt-4 max-w-[520px] text-[14px] leading-6 text-muted-foreground">
          Reimbursements waiting to come back, and money to return to people who paid for you. Expenses stay in the month you spent; repayments land in the month they happen.
        </p>
      </header>

      {report.isLoading ? (
        <div className="mt-7 grid gap-4 sm:grid-cols-2"><Skeleton className="h-36 rounded-[24px]" /><Skeleton className="h-36 rounded-[24px]" /></div>
      ) : report.isError || !data || !side ? (
        <section className="mt-7 rounded-[22px] border border-destructive/25 bg-card px-6 py-9 text-center" data-testid="status-settlements-error">
          <div className="mx-auto grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert size={18} /></div>
          <p className="mt-4 font-display text-xl font-semibold">This didn’t load.</p>
          <p className="mt-2 text-sm text-muted-foreground">{errorText(report.error)}</p>
          <Button onClick={() => report.refetch()} variant="outline" className="mt-5 gap-2"><RotateCcw size={15} /> Try again</Button>
        </section>
      ) : (
        <div className="mt-7 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <BalanceCard direction="owed" side={data.owedToMe} active={direction === 'owed'} onSelect={() => setDirection('owed')} />
            <BalanceCard direction="owing" side={data.iOwe} active={direction === 'owing'} onSelect={() => setDirection('owing')} />
          </div>

          <section data-testid={`section-parties-${direction}`}>
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 className="font-display text-[19px] font-semibold tracking-[-.03em]">{direction === 'owed' ? 'Who owes you' : 'Who you owe'}</h2>
              <span className="text-[11px] text-muted-foreground">Oldest first</span>
            </div>
            {side.parties.length ? (
              <div className="space-y-2.5">
                {side.parties.map((party) => <PartyRow key={party.counterparty.id} party={party} direction={direction} />)}
              </div>
            ) : (
              <div className="rounded-[22px] border border-dashed border-border bg-card/55 px-6 py-10 text-center" data-testid={`status-parties-empty-${direction}`}>
                <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-secondary text-primary"><HandCoins size={19} strokeWidth={1.7} /></div>
                <p className="mt-4 font-display text-[19px] font-semibold tracking-[-.03em]">{direction === 'owed' ? 'Nothing to chase.' : 'You’re all square.'}</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  {direction === 'owed'
                    ? 'When you add an expense, choose “I paid, reimbursable” under Who paid? and it shows up here until it’s paid back.'
                    : 'When someone covers a bill for you, choose “Someone paid for me” on the expense and it shows up here until you pay them back.'}
                </p>
                <Link href="/expenses/new" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground"><Plus size={14} /> Add expense</Link>
              </div>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-settled-history">
              <h2 className="font-display text-[17px] font-semibold tracking-[-.025em]">Settled, by month</h2>
              <p className="mt-1 text-xs text-muted-foreground">Dated when the money moved. Last 6 months.</p>
              {movedMonths.length === 0 ? (
                <p className="mt-5 text-sm text-muted-foreground">Nothing settled yet.</p>
              ) : (
                <table className="mt-4 w-full text-sm" data-testid="table-settled-history">
                  <thead>
                    <tr className="text-left text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">
                      <th className="pb-2 font-bold">Month</th>
                      <th className="pb-2 text-right font-bold">Received</th>
                      <th className="pb-2 text-right font-bold">Paid back</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {movedMonths.map((month) => (
                      <tr key={month.month}>
                        <td className="py-2.5 align-top font-semibold">{formatMonth(month.month)}</td>
                        <td className="py-2.5 pl-3 text-right align-top tabular-nums"><Amounts totals={month.received} /></td>
                        <td className="py-2.5 pl-3 text-right align-top tabular-nums"><Amounts totals={month.repaid} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Link href="/expenses?settlementStatus=settled" className="mt-4 inline-flex text-xs font-bold text-primary hover:underline">See settled expenses</Link>
            </section>
            <PeopleManager />
          </div>
        </div>
      )}
    </div>
  );
}

export default SettlementsPage;
