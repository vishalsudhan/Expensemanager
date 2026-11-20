import { Router, type IRouter } from "express";
import { and, count, eq, gte, lte, min, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  GetCountryCategoryReportQueryParams,
  GetCountryCategoryReportResponse,
} from "@workspace/api-zod";
import type {
  CountryBreakdown,
  CountryCategoryRow,
  CurrencyAmount,
  CurrencyAverage,
} from "@workspace/api-zod";
import { categoriesTable, currenciesTable, db, expensesTable, locationsTable } from "@workspace/db";
import { currencyColumns, sortByCurrencyCode, toCurrency } from "../lib/currency-amounts";

const router: IRouter = Router();

/** The top-level category a leaf rolls up to. */
const parentCategory = alias(categoriesTable, "parent_category");

const DAY_MS = 86_400_000;

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Query-string switch; zod's coerce.boolean would read "false" as true. */
function flag(value: unknown): boolean {
  return value === "true" || value === "1";
}

const toCents = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
};
const fromCents = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;

type CurrencyInfo = ReturnType<typeof toCurrency>;

/** Running per-currency sums, kept exact in whole cents. */
class Bucket {
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

type Category = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  icon: string | null;
  color: string;
  status: "active" | "archived";
};

router.get("/reports/country-categories", async (req, res): Promise<void> => {
  const parsed = GetCountryCategoryReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid date range." });
    return;
  }
  const includeReimbursable = flag(req.query["includeReimbursable"]);

  // A range never runs past tomorrow (UTC): one day of slack covers time zones
  // ahead of the server, so "today" in Doha is always included.
  const latest = addDays(new Date().toISOString().slice(0, 10), 1);
  let to = parsed.data.to ?? new Date().toISOString().slice(0, 10);
  if (!isValidDate(to)) {
    res.status(400).json({ error: "Choose a valid end date." });
    return;
  }
  if (to > latest) to = latest;

  let from = parsed.data.from;
  const allTime = !from;
  if (!from) {
    const [earliest] = await db.select({ date: min(expensesTable.date) }).from(expensesTable);
    from = earliest?.date ?? to;
  }
  if (!isValidDate(from)) {
    res.status(400).json({ error: "Choose a valid start date." });
    return;
  }
  if (from > to) {
    res.status(400).json({ error: "The start date must be on or before the end date." });
    return;
  }

  const days = daysBetween(from, to);
  const previousRange = allTime
    ? null
    : { from: addDays(from, -days), to: addDays(from, -1), days };
  const windowStart = previousRange?.from ?? from;

  const conditions = [
    gte(expensesTable.date, windowStart),
    lte(expensesTable.date, to),
    // Real spending only; a bill payment settles spending already counted.
    eq(expensesTable.transactionType, "expense"),
  ];
  if (!includeReimbursable) conditions.push(ne(expensesTable.settlementType, "reimbursable"));

  const rows = await db
    .select({
      current: sql<boolean>`${expensesTable.date} >= ${from}`.mapWith(Boolean),
      location: {
        id: locationsTable.id,
        name: locationsTable.name,
        slug: locationsTable.slug,
        countryCode: locationsTable.countryCode,
        status: locationsTable.status,
      },
      leaf: {
        id: categoriesTable.id,
        name: categoriesTable.name,
        slug: categoriesTable.slug,
        parentId: categoriesTable.parentId,
        icon: categoriesTable.icon,
        color: categoriesTable.color,
        status: categoriesTable.status,
      },
      parent: {
        id: parentCategory.id,
        name: parentCategory.name,
        slug: parentCategory.slug,
        parentId: parentCategory.parentId,
        icon: parentCategory.icon,
        color: parentCategory.color,
        status: parentCategory.status,
      },
      ...currencyColumns,
      total: sql<string>`sum(${expensesTable.amount})::text`.mapWith(String),
      count: count(expensesTable.id),
    })
    .from(expensesTable)
    .innerJoin(locationsTable, eq(expensesTable.locationId, locationsTable.id))
    .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
    .leftJoin(parentCategory, eq(categoriesTable.parentId, parentCategory.id))
    .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
    .where(and(...conditions))
    .groupBy(sql`1`, locationsTable.id, categoriesTable.id, parentCategory.id, currenciesTable.id);

  type CategoryAgg = {
    category: Category;
    current: Bucket;
    previous: Bucket;
    children: Map<string, { category: Category; current: Bucket; previous: Bucket }>;
  };
  type CountryAgg = {
    location: (typeof rows)[number]["location"];
    current: Bucket;
    previous: Bucket;
    categories: Map<string, CategoryAgg>;
  };
  const countries = new Map<string, CountryAgg>();

  for (const row of rows) {
    const currency = toCurrency(row);
    const top = (row.parent?.id ? row.parent : row.leaf) as Category;
    const country =
      countries.get(row.location.id) ??
      { location: row.location, current: new Bucket(), previous: new Bucket(), categories: new Map() };
    countries.set(row.location.id, country);

    const group =
      country.categories.get(top.id) ??
      { category: top, current: new Bucket(), previous: new Bucket(), children: new Map() };
    country.categories.set(top.id, group);

    const period = row.current ? "current" : "previous";
    country[period].add(currency, row.total, Number(row.count));
    group[period].add(currency, row.total, Number(row.count));

    // An expense filed straight on a top-level category has no subcategory row.
    if (row.leaf.id !== top.id) {
      const leaf = row.leaf as Category;
      const child =
        group.children.get(leaf.id) ?? { category: leaf, current: new Bucket(), previous: new Bucket() };
      group.children.set(leaf.id, child);
      child[period].add(currency, row.total, Number(row.count));
    }
  }

  const breakdown: CountryBreakdown[] = [...countries.values()]
    // A country only appears when something was spent there in the range.
    .filter((country) => country.current.count > 0)
    .sort((a, b) => b.current.count - a.current.count)
    .map((country) => {
      const categories: CountryCategoryRow[] = [...country.categories.values()]
        .filter((group) => group.current.count > 0)
        .sort((a, b) => b.current.rank(country.current) - a.current.rank(country.current))
        .map((group) => ({
          category: group.category,
          totals: group.current.amounts(country.current),
          previousTotals: group.previous.amounts(),
          averagePerDay: group.current.perDay(days),
          children: [...group.children.values()]
            .filter((child) => child.current.count > 0)
            .sort((a, b) => b.current.rank(group.current) - a.current.rank(group.current))
            .map((child) => ({
              category: child.category,
              totals: child.current.amounts(group.current),
              previousTotals: child.previous.amounts(),
            })),
        }));
      return {
        location: country.location,
        totals: country.current.amounts(),
        previousTotals: country.previous.amounts(),
        averagePerDay: country.current.perDay(days),
        categories,
      };
    });

  res.json(
    GetCountryCategoryReportResponse.parse({
      range: { from, to, days },
      previousRange,
      includeReimbursable,
      countries: breakdown,
    }),
  );
});

export default router;
