import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import {
  GetCategoryReportsQueryParams,
  GetLocationReportsQueryParams,
  GetLocationReportsResponse,
  GetCategoryReportsResponse,
  GetLabelReportsQueryParams,
  GetLabelReportsResponse,
  GetPeriodReportQueryParams,
  GetPeriodReportResponse,
  GetProjectReportsQueryParams,
  GetProjectReportsResponse,
} from "@workspace/api-zod";
import type { Currency, CurrencyAmount } from "@workspace/api-zod";
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
import {
  currencyAmountSum,
  currencyColumns,
  currencyExpenseCount,
  toAverages,
  totalCount,
  withShares,
} from "../lib/currency-amounts";

const router: IRouter = Router();

const amount = expensesTable.amount;
const expenseCount = sql<number>`count(*)::int`.mapWith(Number);
const joinedExpenseCount = sql<number>`count(${expensesTable.id})::int`.mapWith(Number);
const distinctExpenseCount = sql<number>`count(distinct ${expensesTable.id})::int`.mapWith(Number);
const monthExpression = sql`date_trunc('month', ${expensesTable.date}::date)`;

const expenseCurrencyJoin = eq(expensesTable.currencyId, currenciesTable.id);
const expenseLocationJoin = eq(expensesTable.locationId, locationsTable.id);

const locationSelection = {
  id: locationsTable.id,
  name: locationsTable.name,
  slug: locationsTable.slug,
  countryCode: locationsTable.countryCode,
  status: locationsTable.status,
};

function toLocation(row: {
  id: string;
  name: string;
  slug: string;
  countryCode: string | null;
  status: "active" | "archived";
}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    countryCode: row.countryCode,
    status: row.status,
  };
}

/**
 * Optional filters shared by every report: a single location, and whether to
 * count payment transactions alongside real spending.
 *
 * Reports answer "where did my money go", so spending defaults to expenses only
 * and bill payments are excluded until a caller explicitly asks for them.
 */
function reportFilters(parsed: {
  data: { locationId?: string; transactionType?: "expense" | "payment" };
}) {
  const conditions: (ReturnType<typeof eq> | undefined)[] = [];
  const { locationId, transactionType } = parsed.data;
  if (locationId) conditions.push(eq(expensesTable.locationId, locationId));
  conditions.push(eq(expensesTable.transactionType, transactionType ?? "expense"));
  return conditions;
}
const projectDefaultCurrencyJoin = eq(projectsTable.defaultCurrencyId, currenciesTable.id);

const projectSelection = {
  id: projectsTable.id,
  name: projectsTable.name,
  description: projectsTable.description,
  color: projectsTable.color,
  icon: projectsTable.icon,
  status: projectsTable.status,
  createdAt: projectsTable.createdAt,
  updatedAt: projectsTable.updatedAt,
};

const categorySelection = {
  id: categoriesTable.id,
  name: categoriesTable.name,
  // slug and parentId are part of ExpenseCategory, so reports carry them too.
  slug: categoriesTable.slug,
  parentId: categoriesTable.parentId,
  icon: categoriesTable.icon,
  color: categoriesTable.color,
  status: categoriesTable.status,
  createdAt: categoriesTable.createdAt,
  updatedAt: categoriesTable.updatedAt,
};

const labelSelection = {
  id: labelsTable.id,
  name: labelsTable.name,
  color: labelsTable.color,
  status: labelsTable.status,
  createdAt: labelsTable.createdAt,
  updatedAt: labelsTable.updatedAt,
};

const expenseCategorySelection = {
  id: categoriesTable.id,
  name: categoriesTable.name,
  // ExpenseCategory requires slug and parentId, and these breakdowns embed it.
  slug: categoriesTable.slug,
  parentId: categoriesTable.parentId,
  icon: categoriesTable.icon,
  color: categoriesTable.color,
  status: categoriesTable.status,
};

const expenseProjectSelection = {
  id: projectsTable.id,
  name: projectsTable.name,
  color: projectsTable.color,
  status: projectsTable.status,
};

const expenseLabelSelection = {
  id: labelsTable.id,
  name: labelsTable.name,
  color: labelsTable.color,
  status: labelsTable.status,
};

const defaultCurrencySelection = {
  defaultCurrencyId: currenciesTable.id,
  defaultCurrencyCode: currenciesTable.code,
  defaultCurrencyName: currenciesTable.name,
  defaultCurrencySymbol: currenciesTable.symbol,
  defaultCurrencyDecimalPlaces: currenciesTable.decimalPlaces,
  defaultCurrencyIsActive: currenciesTable.isActive,
};

/** One row of a "grouped by currency" aggregate. */
interface CurrencyAggregateRow {
  currencyId: string;
  currencyCode: string;
  currencyName: string;
  currencySymbol: string;
  currencyDecimalPlaces: number;
  currencyIsActive: boolean;
  total: string;
  count: number;
}

function toAmounts(rows: readonly CurrencyAggregateRow[]): CurrencyAmount[] {
  return rows
    .map((row) => ({
      currency: {
        id: row.currencyId,
        code: row.currencyCode,
        name: row.currencyName,
        symbol: row.currencySymbol,
        decimalPlaces: row.currencyDecimalPlaces,
        isActive: row.currencyIsActive,
      } satisfies Currency,
      total: String(row.total),
      count: Number(row.count),
    }))
    .sort((a, b) => a.currency.code.localeCompare(b.currency.code));
}

function totalsOf(totals: readonly CurrencyAmount[]): CurrencyAmount[] {
  return [...totals];
}

/** Groups aggregate rows by a key, keeping each currency's total separate. */
function groupByKey<K, R extends CurrencyAggregateRow>(
  rows: readonly R[],
  keyOf: (row: R) => K,
) {
  const grouped = new Map<K, CurrencyAmount[]>();
  for (const row of rows) {
    const [entry] = toAmounts([row]);
    const key = keyOf(row);
    const list = grouped.get(key) ?? [];
    list.push(entry);
    grouped.set(key, list);
  }
  for (const [key, list] of grouped) grouped.set(key, totalsOf(list));
  return grouped;
}

/**
 * Groups aggregate rows by an outer entity and an inner entity (for example
 * project -> category), keeping currencies separated at every level.
 */
function groupByNested<O, I, R extends CurrencyAggregateRow>(
  rows: readonly R[],
  outerKeyOf: (row: R) => O,
  innerKeyOf: (row: R) => I,
) {
  const grouped = new Map<O, Map<I, CurrencyAmount[]>>();
  for (const row of rows) {
    const [entry] = toAmounts([row]);
    const outer = outerKeyOf(row);
    const inner = innerKeyOf(row);
    const byInner = grouped.get(outer) ?? new Map<I, CurrencyAmount[]>();
    const list = byInner.get(inner) ?? [];
    list.push(entry);
    byInner.set(inner, list);
    grouped.set(outer, byInner);
  }
  for (const byInner of grouped.values()) {
    for (const [inner, list] of byInner) byInner.set(inner, totalsOf(list));
  }
  return grouped;
}

/** Fills every label in the spine, so empty periods still render. */
function buildPeriodTrend(
  spine: readonly string[],
  byPeriod: Map<string, CurrencyAmount[]>,
  labelKey: "date" | "month",
) {
  return spine.map((label) => {
    const totals = byPeriod.get(label) ?? [];
    return { [labelKey]: label, totals, count: totalCount(totals) };
  });
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function mapProject(project: {
  id?: string | null;
  name?: string | null;
  color?: string | null;
  status?: "active" | "archived" | null;
} | null) {
  if (!project?.id || !project.name || !project.color || !project.status) return null;
  return { id: project.id, name: project.name, color: project.color, status: project.status };
}

function monthSpine(months: number): string[] {
  const spine: string[] = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCMonth(cursor.getUTCMonth() - (months - 1));
  for (let index = 0; index < months; index += 1) {
    spine.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return spine;
}

function daySpine(from: string, to: string): string[] {
  const spine: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let cursor = Date.parse(`${from}T00:00:00Z`); cursor <= end; cursor += 86400000) {
    spine.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return spine;
}

router.get("/reports/period", async (req, res): Promise<void> => {
  const parsed = GetPeriodReportQueryParams.safeParse(req.query);
  if (!parsed.success || !isValidDate(parsed.data.from) || !isValidDate(parsed.data.to)) {
    res.status(400).json({ error: "A valid start and end date is required." });
    return;
  }

  const { from, to } = parsed.data;
  if (from > to) {
    res.status(400).json({ error: "The start date must be on or before the end date." });
    return;
  }

  const where = and(
    gte(expensesTable.date, from),
    lte(expensesTable.date, to),
    ...reportFilters(parsed),
  );

  const [summaryRows, categoryRows, projectRows, labelRows, locationRows, dailyResult] =
    await Promise.all([
    db
      .select({ ...currencyColumns, total: currencyAmountSum, count: currencyExpenseCount })
      .from(expensesTable)
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(where)
      .groupBy(currenciesTable.id),
    db
      .select({
        entityId: categoriesTable.id,
        category: expenseCategorySelection,
        ...currencyColumns,
        total: currencyAmountSum,
        count: joinedExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(where)
      .groupBy(categoriesTable.id, currenciesTable.id)
      .orderBy(desc(sql`sum(${amount})`), asc(categoriesTable.name)),
    db
      .select({
        entityId: projectsTable.id,
        project: expenseProjectSelection,
        ...currencyColumns,
        total: currencyAmountSum,
        count: joinedExpenseCount,
      })
      .from(expensesTable)
      .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(where)
      .groupBy(projectsTable.id, currenciesTable.id)
      .orderBy(desc(sql`sum(${amount})`), asc(projectsTable.name)),
    db
      .select({
        entityId: labelsTable.id,
        label: expenseLabelSelection,
        ...currencyColumns,
        total: currencyAmountSum,
        count: expenseCount,
      })
      .from(expensesTable)
      .innerJoin(expenseLabelsTable, eq(expenseLabelsTable.expenseId, expensesTable.id))
      .innerJoin(labelsTable, eq(expenseLabelsTable.labelId, labelsTable.id))
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(where)
      .groupBy(labelsTable.id, currenciesTable.id)
      .orderBy(desc(sql`sum(${amount})`), asc(labelsTable.name)),
    db
      .select({
        location: locationSelection,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .innerJoin(locationsTable, expenseLocationJoin)
      .where(where)
      .groupBy(locationsTable.id, currenciesTable.id),
      db.execute(sql`
      select to_char(g, 'YYYY-MM-DD') as "date",
             c.id as "currencyId",
             c.code as "currencyCode",
             c.name as "currencyName",
             c.symbol as "currencySymbol",
             c.decimal_places as "currencyDecimalPlaces",
             c.is_active as "currencyIsActive",
             coalesce(sum(e.amount), 0)::text as total,
             count(e.id)::int as count
      from generate_series(${from}::date, ${to}::date, interval '1 day') as g
      left join expenses e on e.date = g::date
      left join currencies c on e.currency_id = c.id
      where c.id is not null
      group by g, c.id
      order by g
    `),
    ]);

  const summaryTotals = toAmounts(summaryRows);
  const count = totalCount(summaryTotals);

  const dailyRows = (
    dailyResult.rows as unknown as Array<CurrencyAggregateRow & { date: string }>
  ).filter((row) => row.currencyId !== null);

  const dailyTotals = new Map<string, CurrencyAmount[]>();
  for (const row of dailyRows) {
    const [entry] = toAmounts([row]);
    dailyTotals.set(row.date, [...(dailyTotals.get(row.date) ?? []), entry]);
  }

  const categoriesById = groupByKey(categoryRows, (row) => row.entityId);
  const projectsById = groupByKey(projectRows, (row) => row.entityId);
  const labelsById = groupByKey(labelRows, (row) => row.entityId);

  const seenProjects = new Set<string | null>();
  const projectBreakdown = projectRows
    .filter((row) => {
      if (seenProjects.has(row.entityId)) return false;
      seenProjects.add(row.entityId);
      return true;
    })
    .map((row) => {
      const totals = projectsById.get(row.entityId) ?? [];
      return {
        project: mapProject(row.project),
        totals: withShares(totals, summaryTotals),
        count: totalCount(totals),
      };
    });

  res.json(
    GetPeriodReportResponse.parse({
      range: { from, to },
      summary: {
        totals: summaryTotals,
        count,
        averages: toAverages(summaryTotals),
        days: Math.round(
          (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000,
        ) + 1 || 1,
      },
      locationBreakdown: locationRows
        .filter((row, index, rows) => rows.findIndex((r) => r.location.id === row.location.id) === index)
        .map((row) => {
          const totals = locationRows
            .filter((candidate) => candidate.location.id === row.location.id)
            .flatMap((candidate) => toAmounts([candidate]));
          return {
            location: toLocation(row.location),
            totals: withShares(totals, summaryTotals),
            count: totals.reduce((sum, entry) => sum + entry.count, 0),
          };
        }),
      categoryBreakdown: categoryRows
        .filter((row, index, rows) => rows.findIndex((r) => r.entityId === row.entityId) === index)
        .map((row) => {
          const totals = categoriesById.get(row.entityId) ?? [];
          return {
            category: row.category,
            totals: withShares(totals, summaryTotals),
            count: totalCount(totals),
          };
        }),
      projectBreakdown,
      labelBreakdown: labelRows
        .filter((row, index, rows) => rows.findIndex((r) => r.entityId === row.entityId) === index)
        .map((row) => {
          const totals = labelsById.get(row.entityId) ?? [];
          return {
            label: row.label,
            totals: withShares(totals, summaryTotals),
            count: totalCount(totals),
          };
        }),
      dailyTrend: buildPeriodTrend(daySpine(from, to), dailyTotals, "date"),
    }),
  );
});

router.get("/reports/projects", async (req, res): Promise<void> => {
  const parsed = GetProjectReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report options." });
    return;
  }

  const months = parsed.data.months ?? 6;
  const spine = monthSpine(months);
  const firstMonthStart = `${spine[0]}-01`;

  const entityFilters = reportFilters(parsed);

  const [projectRows, totalRows, categoryRows, monthRows] = await Promise.all([
    db
      .select({ project: projectSelection, ...defaultCurrencySelection })
      .from(projectsTable)
      .innerJoin(currenciesTable, projectDefaultCurrencyJoin),
    db
      .select({
        entityId: expensesTable.projectId,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(entityFilters.length ? and(...entityFilters) : undefined)
      .groupBy(expensesTable.projectId, currenciesTable.id),
    db
      .select({
        entityId: expensesTable.projectId,
        innerId: categoriesTable.id,
        category: expenseCategorySelection,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(
        and(
          isNotNull(expensesTable.projectId),
          ...(entityFilters.length ? entityFilters : []),
        ),
      )
      .groupBy(expensesTable.projectId, categoriesTable.id, currenciesTable.id)
      .orderBy(desc(sql`sum(${amount})`), asc(categoriesTable.name)),
    db
      .select({
        entityId: expensesTable.projectId,
        label: sql<string>`to_char(${monthExpression}, 'YYYY-MM')`,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(
        and(
          isNotNull(expensesTable.projectId),
          gte(expensesTable.date, firstMonthStart),
          ...(entityFilters.length ? entityFilters : []),
        ),
      )
      .groupBy(expensesTable.projectId, monthExpression, currenciesTable.id),
  ]);

  const totalsByProject = groupByKey(totalRows, (row) => row.entityId);
  const categoriesByProject = groupByNested(
    categoryRows,
    (row) => row.entityId,
    (row) => row.innerId,
  );
  const monthsByProject = groupByKey(monthRows, (row) => row.entityId);

  res.json(
    GetProjectReportsResponse.parse(
      projectRows.map((row) => {
        const totals = totalsByProject.get(row.project.id) ?? [];
        const categoriesSeen = new Set<string>();
        const categoryBreakdown = categoryRows
          .filter((entry) => entry.entityId === row.project.id)
          .filter((entry) => {
            if (categoriesSeen.has(entry.innerId)) return false;
            categoriesSeen.add(entry.innerId);
            return true;
          })
          .map((entry) => {
            const entryTotals = categoriesByProject.get(row.project.id)?.get(entry.innerId) ?? [];
            return {
              category: entry.category,
              totals: entryTotals,
              count: totalCount(entryTotals),
            };
          });

        const monthLabels = new Map<string, CurrencyAmount[]>();
        for (const entry of monthRows.filter((e) => e.entityId === row.project.id)) {
          const [amount] = toAmounts([entry]);
          monthLabels.set(entry.label, [...(monthLabels.get(entry.label) ?? []), amount]);
        }

        return {
          project: {
            ...row.project,
            defaultCurrency: {
              id: row.defaultCurrencyId,
              code: row.defaultCurrencyCode,
              name: row.defaultCurrencyName,
              symbol: row.defaultCurrencySymbol,
              decimalPlaces: row.defaultCurrencyDecimalPlaces,
              isActive: row.defaultCurrencyIsActive,
            } satisfies Currency,
          },
          totals,
          count: totalCount(totals),
          categoryBreakdown,
          monthlyTrend: buildPeriodTrend(spine, monthLabels, "month"),
        };
      }),
    ),
  );
});

router.get("/reports/categories", async (req, res): Promise<void> => {
  const parsed = GetCategoryReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report options." });
    return;
  }

  const months = parsed.data.months ?? 6;
  const spine = monthSpine(months);
  const firstMonthStart = `${spine[0]}-01`;

  const categoryFilters = reportFilters(parsed);

  const [categoryRows, totalRows, projectRows, monthRows] = await Promise.all([
    db.select({ category: categorySelection }).from(categoriesTable),
    db
      .select({
        entityId: expensesTable.categoryId,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(categoryFilters.length ? and(...categoryFilters) : undefined)
      .groupBy(expensesTable.categoryId, currenciesTable.id),
    db
      .select({
        entityId: expensesTable.categoryId,
        innerId: projectsTable.id,
        project: expenseProjectSelection,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(categoryFilters.length ? and(...categoryFilters) : undefined)
      .groupBy(expensesTable.categoryId, projectsTable.id, currenciesTable.id)
      .orderBy(desc(sql`sum(${amount})`), asc(projectsTable.name)),
    db
      .select({
        entityId: expensesTable.categoryId,
        label: sql<string>`to_char(${monthExpression}, 'YYYY-MM')`,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(
        and(
          gte(expensesTable.date, firstMonthStart),
          ...(categoryFilters.length ? categoryFilters : []),
        ),
      )
      .groupBy(expensesTable.categoryId, monthExpression, currenciesTable.id),
  ]);

  const totalsByCategory = groupByKey(totalRows, (row) => row.entityId);
  const projectsByCategory = groupByNested(
    projectRows,
    (row) => row.entityId,
    (row) => row.innerId ?? "null",
  );

  res.json(
    GetCategoryReportsResponse.parse(
      categoryRows.map((row) => {
        const totals = totalsByCategory.get(row.category.id) ?? [];
        const projectsSeen = new Set<string>();
        const projectDistribution = projectRows
          .filter((entry) => entry.entityId === row.category.id)
          .filter((entry) => {
            const key = entry.innerId ?? "null";
            if (projectsSeen.has(key)) return false;
            projectsSeen.add(key);
            return true;
          })
          .map((entry) => {
            const entryTotals = projectsByCategory.get(row.category.id)?.get(entry.innerId ?? "null") ?? [];
            return {
              project: mapProject(entry.project),
              totals: entryTotals,
              count: totalCount(entryTotals),
            };
          });

        const monthLabels = new Map<string, CurrencyAmount[]>();
        for (const entry of monthRows.filter((e) => e.entityId === row.category.id)) {
          const [amount] = toAmounts([entry]);
          monthLabels.set(entry.label, [...(monthLabels.get(entry.label) ?? []), amount]);
        }

        return {
          category: row.category,
          totals,
          count: totalCount(totals),
          projectDistribution,
          monthlyTrend: buildPeriodTrend(spine, monthLabels, "month"),
        };
      }),
    ),
  );
});

router.get("/reports/labels", async (req, res): Promise<void> => {
  const parsed = GetLabelReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report options." });
    return;
  }

  const months = parsed.data.months ?? 6;
  const spine = monthSpine(months);
  const firstMonthStart = `${spine[0]}-01`;

  const labelFilters = reportFilters(parsed);

  const [labelRows, totalRows, monthRows] = await Promise.all([
    db.select({ label: labelSelection }).from(labelsTable),
    db
      .select({
        entityId: expenseLabelsTable.labelId,
        ...currencyColumns,
        total: currencyAmountSum,
        count: distinctExpenseCount,
      })
      .from(expenseLabelsTable)
      .innerJoin(expensesTable, eq(expenseLabelsTable.expenseId, expensesTable.id))
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(labelFilters.length ? and(...labelFilters) : undefined)
      .groupBy(expenseLabelsTable.labelId, currenciesTable.id),
    db
      .select({
        entityId: expenseLabelsTable.labelId,
        label: sql<string>`to_char(${monthExpression}, 'YYYY-MM')`,
        ...currencyColumns,
        total: currencyAmountSum,
        count: distinctExpenseCount,
      })
      .from(expenseLabelsTable)
      .innerJoin(expensesTable, eq(expenseLabelsTable.expenseId, expensesTable.id))
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(
        and(
          gte(expensesTable.date, firstMonthStart),
          ...(labelFilters.length ? labelFilters : []),
        ),
      )
      .groupBy(expenseLabelsTable.labelId, monthExpression, currenciesTable.id),
  ]);

  const totalsByLabel = groupByKey(totalRows, (row) => row.entityId);

  res.json(
    GetLabelReportsResponse.parse(
      labelRows.map((row) => {
        const totals = totalsByLabel.get(row.label.id) ?? [];

        const monthLabels = new Map<string, CurrencyAmount[]>();
        for (const entry of monthRows.filter((e) => e.entityId === row.label.id)) {
          const [amount] = toAmounts([entry]);
          monthLabels.set(entry.label, [...(monthLabels.get(entry.label) ?? []), amount]);
        }

        return {
          label: row.label,
          totals,
          count: totalCount(totals),
          monthlyTrend: buildPeriodTrend(spine, monthLabels, "month"),
        };
      }),
    ),
  );
});

router.get("/reports/locations", async (req, res): Promise<void> => {
  const parsed = GetLocationReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report options." });
    return;
  }

  const months = parsed.data.months ?? 6;
  const spine = monthSpine(months);
  const firstMonthStart = `${spine[0]}-01`;

  const [locationRows, totalRows, categoryRows, monthRows] = await Promise.all([
    db.select({ location: locationSelection }).from(locationsTable).orderBy(asc(locationsTable.name)),
    db
      .select({
        entityId: expensesTable.locationId,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      // This is a spending report, so bill payments never contribute.
      .where(eq(expensesTable.transactionType, "expense"))
      .groupBy(expensesTable.locationId, currenciesTable.id),
    db
      .select({
        entityId: expensesTable.locationId,
        category: expenseCategorySelection,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(eq(expensesTable.transactionType, "expense"))
      .groupBy(expensesTable.locationId, categoriesTable.id, currenciesTable.id)
      .orderBy(desc(sql`sum(${amount})`), asc(categoriesTable.name)),
    db
      .select({
        entityId: expensesTable.locationId,
        label: sql<string>`to_char(${monthExpression}, 'YYYY-MM')`,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(
        and(
          eq(expensesTable.transactionType, "expense"),
          gte(expensesTable.date, firstMonthStart),
        ),
      )
      .groupBy(expensesTable.locationId, monthExpression, currenciesTable.id),
  ]);

  const totalsByLocation = groupByKey(totalRows, (row) => row.entityId);
  const categoriesByLocation = groupByNested(
    categoryRows,
    (row) => row.entityId,
    (row) => row.category.id,
  );

  res.json(
    GetLocationReportsResponse.parse(
      locationRows.map((row) => {
        const totals = totalsByLocation.get(row.location.id) ?? [];
        const categoriesSeen = new Set<string>();
        const categorySpending = categoryRows
          .filter((entry) => entry.entityId === row.location.id)
          .filter((entry) => {
            if (categoriesSeen.has(entry.category.id)) return false;
            categoriesSeen.add(entry.category.id);
            return true;
          })
          .map((entry) => {
            const entryTotals =
              categoriesByLocation.get(row.location.id)?.get(entry.category.id) ?? [];
            return {
              category: entry.category,
              totals: withShares(entryTotals, totals),
              count: totalCount(entryTotals),
            };
          });

        const monthLabels = new Map<string, CurrencyAmount[]>();
        for (const entry of monthRows.filter((e) => e.entityId === row.location.id)) {
          const [entryAmount] = toAmounts([entry]);
          monthLabels.set(entry.label, [...(monthLabels.get(entry.label) ?? []), entryAmount]);
        }

        return {
          location: toLocation(row.location),
          totals,
          count: totalCount(totals),
          categorySpending,
          monthlyTrend: buildPeriodTrend(spine, monthLabels, "month"),
        };
      }),
    ),
  );
});

export default router;