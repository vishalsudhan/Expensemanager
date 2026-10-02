import { count, sql } from "drizzle-orm";
import { currenciesTable, expensesTable } from "@workspace/db";
import type { Currency, CurrencyAmount, CurrencyAverage } from "@workspace/api-zod";

/**
 * Currency columns to select alongside any expense aggregate so the result can be
 * reported per currency. Amounts are never summed across currencies, so every
 * aggregate carries the currency it belongs to.
 */
export const currencyColumns = {
  currencyId: currenciesTable.id,
  currencyCode: currenciesTable.code,
  currencyName: currenciesTable.name,
  currencySymbol: currenciesTable.symbol,
  currencyDecimalPlaces: currenciesTable.decimalPlaces,
  currencyIsActive: currenciesTable.isActive,
};

export const currencyAmountSum = sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`.mapWith(
  String,
);

export const currencyExpenseCount = count(expensesTable.id);

interface CurrencyRow {
  currencyId: string;
  currencyCode: string;
  currencyName: string;
  currencySymbol: string;
  currencyDecimalPlaces: number;
  currencyIsActive: boolean;
  total: string;
  count: number;
}

export function toCurrency(row: Omit<CurrencyRow, "total" | "count">): Currency {
  return {
    id: row.currencyId,
    code: row.currencyCode,
    name: row.currencyName,
    symbol: row.currencySymbol,
    decimalPlaces: row.currencyDecimalPlaces,
    isActive: row.currencyIsActive,
  };
}

export function toCurrencyAmounts(rows: readonly CurrencyRow[]): CurrencyAmount[] {
  return rows.map((row) => ({
    currency: toCurrency(row),
    total: String(row.total),
    count: Number(row.count),
  }));
}

export function totalCount(totals: readonly CurrencyAmount[]): number {
  return totals.reduce((sum, entry) => sum + Number(entry.count), 0);
}

/**
 * Adds each entry's share of the overall total *within the same currency*.
 * Cross-currency comparison is deliberately not attempted.
 */
export function withShares(
  totals: readonly CurrencyAmount[],
  overall: readonly CurrencyAmount[],
): CurrencyAmount[] {
  const overallByCurrency = new Map(overall.map((entry) => [entry.currency.id, Number(entry.total)]));
  return totals.map((entry) => {
    const base = overallByCurrency.get(entry.currency.id) ?? 0;
    return { ...entry, share: base > 0 ? Number(entry.total) / base : 0 };
  });
}

export function toAverages(totals: readonly CurrencyAmount[]): CurrencyAverage[] {
  return totals.map((entry) => ({
    currency: entry.currency,
    amount: entry.count > 0 ? (Number(entry.total) / entry.count).toFixed(2) : "0.00",
  }));
}

/** Sorts grouped totals by currency code so responses stay stable. */
export function sortByCurrencyCode(totals: CurrencyAmount[]): CurrencyAmount[] {
  return [...totals].sort((a, b) => a.currency.code.localeCompare(b.currency.code));
}

/** Groups currency rows by an arbitrary key (entity id, period label, ...). */
export function groupTotalsBy<K>(
  rows: readonly CurrencyRow[],
  keyOf: (row: CurrencyRow) => K | null,
): Map<K, CurrencyAmount[]> {
  const grouped = new Map<K, CurrencyAmount[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null || key === undefined) continue;
    const list = grouped.get(key) ?? [];
    list.push({
      currency: toCurrency(row),
      total: String(row.total),
      count: Number(row.count),
    });
    grouped.set(key, list);
  }
  for (const [key, list] of grouped) {
    grouped.set(key, sortByCurrencyCode(list));
  }
  return grouped;
}