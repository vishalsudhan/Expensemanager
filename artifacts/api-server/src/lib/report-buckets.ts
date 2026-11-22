import type { CurrencyAmount, CurrencyAverage } from "@workspace/api-zod";
import { sortByCurrencyCode, toCurrency } from "./currency-amounts";

const DAY_MS = 86_400_000;

export function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Query-string switch; zod's coerce.boolean would read "false" as true. */
export function flag(value: unknown): boolean {
  return value === "true" || value === "1";
}

const toCents = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
};
const fromCents = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;

export type CurrencyInfo = ReturnType<typeof toCurrency>;

/** Running per-currency sums, kept exact in whole cents. */
export class Bucket {
  private byCurrency = new Map<string, { currency: CurrencyInfo; cents: bigint; count: number }>();

  add(currency: CurrencyInfo, total: string, rowCount: number) {
    const entry = this.byCurrency.get(currency.id) ?? { currency, cents: 0n, count: 0 };
    entry.cents += toCents(total);
    entry.count += rowCount;
    this.byCurrency.set(currency.id, entry);
  }

  cents(currencyId: string): bigint {
    return this.byCurrency.get(currencyId)?.cents ?? 0n;
  }

  /**
   * Ordering key: the largest share this bucket holds of its parent, per
   * currency. Raw amounts are never compared across currencies (a rupee total
   * is not "bigger" than a riyal one), so ranking uses shares instead.
   */
  rank(parent: Bucket): number {
    let largest = 0;
    for (const [id, entry] of this.byCurrency) {
      const base = parent.cents(id);
      if (base > 0n) largest = Math.max(largest, Number(entry.cents) / Number(base));
    }
    return largest;
  }

  get count(): number {
    let total = 0;
    for (const entry of this.byCurrency.values()) total += entry.count;
    return total;
  }

  amounts(shareOf?: Bucket): CurrencyAmount[] {
    return sortByCurrencyCode(
      [...this.byCurrency.values()].map(({ currency, cents, count: n }) => {
        const amount: CurrencyAmount = { currency, total: fromCents(cents), count: n };
        if (shareOf) {
          const base = shareOf.cents(currency.id);
          amount.share = base > 0n ? Number(cents) / Number(base) : 0;
        }
        return amount;
      }),
    );
  }

  perDay(days: number): CurrencyAverage[] {
    if (days <= 0) return [];
    return [...this.byCurrency.values()]
      .sort((x, y) => x.currency.code.localeCompare(y.currency.code))
      .map(({ currency, cents }) => ({ currency, amount: (Number(cents) / 100 / days).toFixed(2) }));
  }
}

