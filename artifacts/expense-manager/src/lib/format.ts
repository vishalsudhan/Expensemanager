import type { Currency, CurrencyAmount } from '@workspace/api-client-react';

/** Amount pattern accepted by the API for a single expense amount. */
export const AMOUNT_PATTERN = /^[0-9]{1,12}(\.[0-9]{1,2})?$/;

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatterFor(currencyCode: string, decimalPlaces: number): Intl.NumberFormat {
  const key = `${currencyCode}:${decimalPlaces}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  const created = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
  formatterCache.set(key, created);
  return created;
}

/**
 * Formats an amount in the given currency. Falls back to the raw amount plus
 * the currency code when the code is not a known ISO currency.
 */
export function money(amount: string | number, currency?: Currency | null): string {
  const value = Number(amount || 0);
  if (!currency) return `${value.toFixed(2)} INR`;

  try {
    return formatterFor(currency.code, currency.decimalPlaces).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency.code}`;
  }
}

/** Formats an amount using only an ISO currency code. */
export function moneyByCode(amount: string | number, code = 'INR'): string {
  try {
    return formatterFor(code, 2).format(Number(amount || 0));
  } catch {
    return `${Number(amount || 0).toFixed(2)} ${code}`;
  }
}

/** Short label for a currency, e.g. "INR" or "₹ INR". */
export function currencyLabel(currency: Currency): string {
  return `${currency.symbol} ${currency.code}`;
}

function sortTotals(totals: readonly CurrencyAmount[]): CurrencyAmount[] {
  return [...totals].sort((a, b) => b.total.localeCompare(a.total, undefined, { numeric: true }));
}

/**
 * Renders totals that stay separated per currency. Never sums across
 * currencies; a single-currency total renders as a plain amount.
 */
export function formatTotals(totals: readonly CurrencyAmount[] | undefined): string {
  if (!totals || totals.length === 0) return money(0);

  const entries = sortTotals(totals);
  if (entries.length === 1) return money(entries[0].total, entries[0].currency);
  return entries.map((entry) => money(entry.total, entry.currency)).join(' · ');
}

/** True when the totals span more than one currency. */
export function isMultiCurrency(totals: readonly CurrencyAmount[] | undefined): boolean {
  return (totals?.length ?? 0) > 1;
}

/** Picks the currency used for a headline figure, preferring the given default. */
export function primaryCurrency(
  totals: readonly CurrencyAmount[] | undefined,
  preferred?: Currency | null,
): Currency | null {
  if (!totals || totals.length === 0) return preferred ?? null;
  if (preferred) {
    const match = totals.find((entry) => entry.currency.id === preferred.id);
    if (match) return match.currency;
  }
  return sortTotals(totals)[0].currency;
}

/** Total amount for a single currency within a grouped list. */
export function totalFor(
  totals: readonly CurrencyAmount[] | undefined,
  currencyId: string | null | undefined,
): string {
  if (!currencyId) return '0';
  const match = totals?.find((entry) => entry.currency.id === currencyId);
  return match ? match.total : '0';
}

function safeDate(value: string): Date | null {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string): string {
  const date = safeDate(value);
  return date
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(date)
    : value;
}

export function formatShortDate(value: string): string {
  const date = safeDate(value);
  return date
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
    : value;
}

export function formatMonth(value: string): string {
  const [year, month] = value.split('-');
  if (!year || !month) return value;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1, 12));
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(date);
}

export function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { error?: unknown; message?: unknown };
    if (typeof candidate.error === 'string') return candidate.error;
    if (typeof candidate.message === 'string' && candidate.message) return candidate.message;
  }
  if (typeof error === 'string' && error) return error;
  return 'Something went wrong. Please try again.';
}