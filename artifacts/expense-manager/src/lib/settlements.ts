import type {
  CurrencyAmount,
  ExpenseSettlementStatus,
  ExpenseSettlementType,
} from '@workspace/api-client-react';

/** The three answers to "Who paid?" on an expense. */
export const settlementTypeOptions: { value: ExpenseSettlementType; label: string; hint: string }[] = [
  { value: 'none', label: 'I paid', hint: 'Your own cost.' },
  { value: 'reimbursable', label: 'I paid, reimbursable', hint: 'Someone will pay you back.' },
  { value: 'paid_by_other', label: 'Someone paid for me', hint: 'You owe them.' },
];

export function counterpartyQuestion(type: ExpenseSettlementType): string {
  return type === 'paid_by_other' ? 'Who paid?' : 'Who reimburses you?';
}

/** Status options valid for each direction. "Claimed" only means something for reimbursements. */
export function statusOptions(type: ExpenseSettlementType): { value: ExpenseSettlementStatus; label: string }[] {
  if (type === 'paid_by_other') {
    return [
      { value: 'pending', label: 'To pay back' },
      { value: 'settled', label: 'Paid back' },
    ];
  }
  return [
    { value: 'pending', label: 'Pending' },
    { value: 'claimed', label: 'Claimed' },
    { value: 'settled', label: 'Received' },
  ];
}

export function statusLabel(type: ExpenseSettlementType, status: ExpenseSettlementStatus | null | undefined): string {
  if (!status) return '';
  return statusOptions(type).find((option) => option.value === status)?.label ?? status;
}

export function settledVerb(type: ExpenseSettlementType): string {
  return type === 'paid_by_other' ? 'Paid back' : 'Received';
}

/** Compact badge text for lists, e.g. "Reimbursable · WebCastle · Pending". */
export function settlementBadge(
  type: ExpenseSettlementType,
  counterpartyName: string | undefined,
  status: ExpenseSettlementStatus | null | undefined,
): string {
  const kind = type === 'paid_by_other' ? `Paid by ${counterpartyName ?? 'someone'}` : `Reimbursable · ${counterpartyName ?? ''}`;
  return `${kind} · ${statusLabel(type, status)}`;
}

/** Tailwind classes for a status: open items stand out, settled ones recede. */
export function statusTone(status: ExpenseSettlementStatus | null | undefined): string {
  if (status === 'settled') return 'border-border/70 bg-secondary/40 text-muted-foreground';
  if (status === 'claimed') return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  return 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

/**
 * Subtracts b from a per currency (a - b), never across currencies. Used for
 * "your own cost" = spent - reimbursable.
 */
export function subtractTotals(a: readonly CurrencyAmount[], b: readonly CurrencyAmount[]): CurrencyAmount[] {
  const cents = (value: string) => Math.round(Number(value) * 100);
  const minus = new Map(b.map((entry) => [entry.currency.id, entry]));
  return a.map((entry) => {
    const other = minus.get(entry.currency.id);
    const remaining = cents(entry.total) - (other ? cents(other.total) : 0);
    return {
      currency: entry.currency,
      total: (Math.max(remaining, 0) / 100).toFixed(2),
      count: entry.count - (other?.count ?? 0),
    };
  });
}

/** Local calendar date as YYYY-MM-DD (not UTC, so late evening in Doha stays today). */
export function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
