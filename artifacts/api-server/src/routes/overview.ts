import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, lte, min, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { GetReportOverviewQueryParams, GetReportOverviewResponse } from "@workspace/api-zod";
import type { CountrySummary, ReportOverview } from "@workspace/api-zod";
import {
  categoriesTable,
  currenciesTable,
  db,
  expenseLabelsTable,
  expensesTable,
  labelsTable,
  locationsTable,
  projectsTable,
} from "@workspace/db";
import { currencyColumns, toCurrency } from "../lib/currency-amounts";
import { Bucket, addDays, daysBetween, flag, isValidDate } from "../lib/report-buckets";

const router: IRouter = Router();

const parentCategory = alias(categoriesTable, "parent_category");

const locationSelection = {
  id: locationsTable.id,
  name: locationsTable.name,
  slug: locationsTable.slug,
  countryCode: locationsTable.countryCode,
  status: locationsTable.status,
};

const leafColumns = {
  id: categoriesTable.id,
  name: categoriesTable.name,
  slug: categoriesTable.slug,
  parentId: categoriesTable.parentId,
  icon: categoriesTable.icon,
  color: categoriesTable.color,
  status: categoriesTable.status,
};
const parentColumns = {
  id: parentCategory.id,
  name: parentCategory.name,
  slug: parentCategory.slug,
  parentId: parentCategory.parentId,
  icon: parentCategory.icon,
  color: parentCategory.color,
  status: parentCategory.status,
};

type Category = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  icon: string | null;
  color: string;
  status: "active" | "archived";
};

type Granularity = "day" | "week" | "month";

/** Bars stay readable: daily up to ~6 weeks, weekly up to ~7 months, then monthly. */
function granularityFor(days: number): Granularity {
  if (days <= 45) return "day";
  if (days <= 210) return "week";
  return "month";
}

function bucketStart(date: string, granularity: Granularity): string {
  if (granularity === "day") return date;
  if (granularity === "month") return `${date.slice(0, 7)}-01`;
  // ISO week, Monday first (matches date_trunc('week')).
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

function bucketSpine(from: string, to: string, granularity: Granularity): string[] {
  const spine: string[] = [];
  let cursor = bucketStart(from, granularity);
  while (cursor <= to) {
    spine.push(cursor);
    if (granularity === "day") cursor = addDays(cursor, 1);
    else if (granularity === "week") cursor = addDays(cursor, 7);
    else {
      const d = new Date(`${cursor}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      cursor = d.toISOString().slice(0, 10);
    }
  }
  return spine;
}

const money = { ...currencyColumns, total: sql<string>`sum(${expensesTable.amount})::text`.mapWith(String), count: count(expensesTable.id) };

router.get("/reports/overview", async (req, res): Promise<void> => {
  const parsed = GetReportOverviewQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid date range and country." });
    return;
  }
  const includeReimbursable = flag(req.query["includeReimbursable"]);

  const today = new Date().toISOString().slice(0, 10);
  const latest = addDays(today, 1); // One day of slack for time zones ahead of UTC.
  let to = parsed.data.to ?? today;
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
  const previousRange = allTime ? null : { from: addDays(from, -days), to: addDays(from, -1), days };
  const windowStart = previousRange?.from ?? from;

  // Real spending only; reimbursable is someone else's cost unless asked for.
  const spending: SQL[] = [eq(expensesTable.transactionType, "expense")];
  if (!includeReimbursable) spending.push(ne(expensesTable.settlementType, "reimbursable"));

  const rows = await db
    .select({
      current: sql<boolean>`${expensesTable.date} >= ${from}`.mapWith(Boolean),
      location: locationSelection,
      leaf: leafColumns,
      parent: parentColumns,
      ...money,
    })
    .from(expensesTable)
    .innerJoin(locationsTable, eq(expensesTable.locationId, locationsTable.id))
    .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
    .leftJoin(parentCategory, eq(categoriesTable.parentId, parentCategory.id))
    .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
    .where(and(gte(expensesTable.date, windowStart), lte(expensesTable.date, to), ...spending))
    .groupBy(sql`1`, locationsTable.id, categoriesTable.id, parentCategory.id, currenciesTable.id);

  type Group = {
    category: Category;
    current: Bucket;
    previous: Bucket;
    children: Map<string, { category: Category; current: Bucket; previous: Bucket }>;
  };
  type Country = {
    location: (typeof rows)[number]["location"];
    current: Bucket;
    previous: Bucket;
    groups: Map<string, Group>;
  };
  const countries = new Map<string, Country>();

  for (const row of rows) {
    const currency = toCurrency(row);
    const period = row.current ? "current" : "previous";
    const n = Number(row.count);
    const top = (row.parent?.id ? row.parent : row.leaf) as Category;

    const country =
      countries.get(row.location.id) ??
      { location: row.location, current: new Bucket(), previous: new Bucket(), groups: new Map() };
    countries.set(row.location.id, country);
    country[period].add(currency, row.total, n);

    const group =
      country.groups.get(top.id) ??
      { category: top, current: new Bucket(), previous: new Bucket(), children: new Map() };
    country.groups.set(top.id, group);
    group[period].add(currency, row.total, n);

    if (row.leaf.id !== top.id) {
      const leaf = row.leaf as Category;
      const child = group.children.get(leaf.id) ?? { category: leaf, current: new Bucket(), previous: new Bucket() };
      group.children.set(leaf.id, child);
      child[period].add(currency, row.total, n);
    }
  }

  const active = [...countries.values()]
    .filter((country) => country.current.count > 0)
    .sort((a, b) => b.current.count - a.current.count);

  const summaries: CountrySummary[] = active.map((country) => ({
    location: country.location,
    totals: country.current.amounts(),
    previousTotals: country.previous.amounts(),
    averagePerDay: country.current.perDay(days),
  }));

  // The country the detail is for: the one asked for, else the busiest one.
  let selected = parsed.data.locationId
    ? countries.get(parsed.data.locationId)
    : active[0];
  let selectedLocation = selected?.location ?? null;
  if (parsed.data.locationId && !selected) {
    const [location] = await db
      .select(locationSelection)
      .from(locationsTable)
      .where(eq(locationsTable.id, parsed.data.locationId));
    if (!location) {
      res.status(400).json({ error: "That country doesn't exist." });
      return;
    }
    selectedLocation = location;
  }

  const granularity = granularityFor(days);
  type Detail = Pick<
    ReportOverview,
    | "totals" | "previousTotals" | "averagePerDay" | "categories" | "timeline"
    | "projects" | "labels" | "paymentMethods" | "topExpenses"
  >;
  const empty: Detail = {
    totals: [],
    previousTotals: [],
    averagePerDay: [],
    categories: [],
    timeline: { granularity, buckets: bucketSpine(from, to, granularity).map((start) => ({ start, totals: [] })) },
    projects: [],
    labels: [],
    paymentMethods: [],
    topExpenses: [],
  };

  let detail: Detail = empty;
  if (selectedLocation && selected) {
    const country = selected;
    const inRange = and(
      gte(expensesTable.date, from),
      lte(expensesTable.date, to),
      eq(expensesTable.locationId, selectedLocation.id),
      ...spending,
    );

    const [timelineRows, projectRows, labelRows, methodRows, topRows] = await Promise.all([
      db
        .select({ date: expensesTable.date, ...money })
        .from(expensesTable)
        .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
        .where(inRange)
        .groupBy(expensesTable.date, currenciesTable.id),
      db
        .select({
          project: { id: projectsTable.id, name: projectsTable.name, color: projectsTable.color, status: projectsTable.status },
          ...money,
        })
        .from(expensesTable)
        .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
        .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
        .where(inRange)
        .groupBy(projectsTable.id, currenciesTable.id),
      db
        .select({
          label: { id: labelsTable.id, name: labelsTable.name, color: labelsTable.color, status: labelsTable.status },
          ...money,
        })
        .from(expensesTable)
        .innerJoin(expenseLabelsTable, eq(expenseLabelsTable.expenseId, expensesTable.id))
        .innerJoin(labelsTable, eq(expenseLabelsTable.labelId, labelsTable.id))
        .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
        .where(inRange)
        .groupBy(labelsTable.id, currenciesTable.id),
      db
        .select({ method: expensesTable.paymentMethod, ...money })
        .from(expensesTable)
        .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
        .where(inRange)
        .groupBy(expensesTable.paymentMethod, currenciesTable.id),
      db
        .select({
          id: expensesTable.id,
          date: expensesTable.date,
          amount: expensesTable.amount,
          description: expensesTable.description,
          category: leafColumns,
          ...currencyColumns,
        })
        .from(expensesTable)
        .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
        .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
        .where(inRange)
        .orderBy(desc(expensesTable.amount), desc(expensesTable.date))
        .limit(5),
    ]);

    // Grouped rows -> ranked rows with shares of the country total, per currency.
    const rank = <R extends { total: string; count: number } & Parameters<typeof toCurrency>[0], K, T>(
      rowsIn: R[],
      keyOf: (row: R) => K,
      build: (row: R) => T,
    ) => {
      const grouped = new Map<K, { value: T; bucket: Bucket }>();
      for (const row of rowsIn) {
        const key = keyOf(row);
        const entry = grouped.get(key) ?? { value: build(row), bucket: new Bucket() };
        entry.bucket.add(toCurrency(row), row.total, Number(row.count));
        grouped.set(key, entry);
      }
      return [...grouped.values()]
        .sort((a, b) => b.bucket.rank(country.current) - a.bucket.rank(country.current))
        .map(({ value, bucket }) => ({ value, totals: bucket.amounts(country.current) }));
    };

    const byBucket = new Map<string, Bucket>();
    for (const row of timelineRows) {
      const key = bucketStart(String(row.date), granularity);
      const bucket = byBucket.get(key) ?? new Bucket();
      bucket.add(toCurrency(row), row.total, Number(row.count));
      byBucket.set(key, bucket);
    }

    detail = {
      totals: country.current.amounts(),
      previousTotals: country.previous.amounts(),
      averagePerDay: country.current.perDay(days),
      categories: [...country.groups.values()]
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
        })),
      timeline: {
        granularity,
        buckets: bucketSpine(from, to, granularity).map((start) => ({
          start,
          totals: byBucket.get(start)?.amounts() ?? [],
        })),
      },
      projects: rank(projectRows, (row) => row.project?.id ?? null, (row) => (row.project?.id ? row.project : null)).map(
        ({ value, totals }) => ({ project: value, totals }),
      ),
      labels: rank(labelRows, (row) => row.label.id, (row) => row.label).map(({ value, totals }) => ({ label: value, totals })),
      paymentMethods: rank(methodRows, (row) => row.method ?? null, (row) => row.method ?? null).map(
        ({ value, totals }) => ({ method: value, totals }),
      ),
      topExpenses: topRows.map((row) => ({
        id: row.id,
        date: String(row.date),
        amount: String(row.amount),
        currency: toCurrency(row),
        description: row.description,
        category: row.category,
      })),
    };
  }

  res.json(
    GetReportOverviewResponse.parse({
      range: { from, to, days },
      previousRange,
      includeReimbursable,
      countries: summaries,
      location: selectedLocation,
      ...detail,
    }),
  );
});

export default router;
