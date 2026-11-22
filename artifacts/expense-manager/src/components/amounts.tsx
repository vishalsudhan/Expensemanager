import type { CurrencyAmount, CurrencyAverage } from '@workspace/api-client-react';
import { money } from '@/lib/format';

/**
 * Per-currency amounts, one per line and never broken mid-number. Amounts in
 * different currencies are never added together, so several can appear.
 */
export function Amounts({
  totals,
  averages,
  className = '',
  testId,
}: {
  totals?: CurrencyAmount[];
  averages?: CurrencyAverage[];
  className?: string;
  testId?: string;
}) {
  const lines = totals
    ? // The currency with the most entries first, so a country's own currency leads.
      [...totals].sort((x, y) => y.count - x.count).map((t) => ({ id: t.currency.id, text: money(t.total, t.currency) }))
    : (averages ?? []).map((a) => ({ id: a.currency.id, text: money(a.amount, a.currency) }));
  if (lines.length === 0) return <span className={className} data-testid={testId}>—</span>;
  return (
    <span className={`inline-flex flex-col ${className}`} data-testid={testId}>
      {lines.map((line) => (
        <span key={line.id} className="whitespace-nowrap">{line.text}</span>
      ))}
    </span>
  );
}
