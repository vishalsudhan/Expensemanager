import { useMemo } from 'react';
import { useListCurrencies } from '@workspace/api-client-react';
import type { Currency } from '@workspace/api-client-react';

/** Currency used when nothing else is known (also the migration default). */
export const FALLBACK_CURRENCY_CODE = 'INR';

export function useCurrencyOptions(): {
  currencies: Currency[];
  activeCurrencies: Currency[];
  isLoading: boolean;
  isError: boolean;
} {
  const query = useListCurrencies();

  // Memoized so callers can safely use these arrays as effect dependencies.
  const currencies = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => a.code.localeCompare(b.code)),
    [query.data],
  );
  const activeCurrencies = useMemo(
    () => currencies.filter((currency) => currency.isActive),
    [currencies],
  );

  return {
    currencies,
    activeCurrencies,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/** Currency new expenses and projects start in, when it is switched on. */
export const DEFAULT_CURRENCY_CODE = 'QAR';

/** The default currency if available, otherwise the first active one. */
export function defaultCurrency(currencies: readonly Currency[]): Currency | null {
  return (
    currencies.find((currency) => currency.isActive && currency.code === DEFAULT_CURRENCY_CODE) ??
    currencies.find((currency) => currency.isActive) ??
    currencies[0] ??
    null
  );
}

/** Finds a currency by id, falling back to the first active one. */
export function findCurrency(
  currencies: readonly Currency[],
  currencyId: string | null | undefined,
): Currency | null {
  if (!currencies.length) return null;
  if (currencyId) {
    const match = currencies.find((currency) => currency.id === currencyId);
    if (match) return match;
  }
  return currencies.find((currency) => currency.isActive) ?? currencies[0];
}

/** Finds a currency by ISO code, falling back to the first active one. */
export function findCurrencyByCode(
  currencies: readonly Currency[],
  code: string | null | undefined,
): Currency | null {
  if (!currencies.length) return null;
  if (code) {
    const match = currencies.find((currency) => currency.code === code);
    if (match) return match;
  }
  return currencies.find((currency) => currency.isActive) ?? currencies[0];
}