import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { GetDashboardQueryParams, GetDashboardResponse } from "@workspace/api-zod";
import type { Currency, CurrencyAmount } from "@workspace/api-zod";
import { categoriesTable, currenciesTable, db, expensesTable, projectsTable } from "@workspace/db";
import {
  currencyAmountSum,
  currencyColumns,
  currencyExpenseCount,
  totalCount,
  withShares,
} from "../lib/currency-amounts";
import { attachLabels, expenseSelection } from "../lib/expense-records";

const router: IRouter = Router();

const amount = expensesTable.amount;
const monthStart = sql`date_trunc('month', current_date)::date`;
const monthEnd = sql`(date_trunc('month', current_date) + interval '1 month')::date`;
const weekStart = sql`date_trunc('week', current_date)::date`;
const weekEnd = sql`(date_trunc('week', current_date) + interval '7 days')::date`;
const expenseCurrencyJoin = eq(expensesTable.currencyId, currenciesTable.id);
const currentMonth = and(gte(expensesTable.date, monthStart), lt(expensesTable.date, monthEnd));

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

type CurrencySummaryPeriod = "today" | "week" | "month" | "allTime";

function periodCondition(period: CurrencySummaryPeriod) {
  switch (period) {
    case "today":
      return eq(expensesTable.date, sql`current_date`);
    case "week":
      return and(gte(expensesTable.date, weekStart), lt(expensesTable.date, weekEnd));
    case "month":
      return currentMonth;
    default:
      return undefined;
  }
}

async function currencySummary(period: CurrencySummaryPeriod): Promise<CurrencyAmount[]> {
  const rows = await db
    .select({ ...currencyColumns, total: currencyAmountSum, count: currencyExpenseCount })
    .from(expensesTable)
    .innerJoin(currenciesTable, expenseCurrencyJoin)
    .where(periodCondition(period))
    .groupBy(currenciesTable.id);
  return toAmounts(rows);
}

/** Every trend bucket is returned, even when it has no expenses. */
function trendSpine(granularity: "day" | "week" | "month"): string[] {
  const labels: string[] = [];
  const now = new Date();

  if (granularity === "day") {
    for (let offset = 13; offset >= 0; offset -= 1) {
      const day = new Date(now);
      day.setUTCDate(day.getUTCDate() - offset);
      labels.push(day.toISOString().slice(0, 10));
    }
    return labels;
  }

  const step = granularity === "week" ? 7 : 1;
  const start = new Date(now);
  if (granularity === "week") {
    const weekday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - weekday);
  } else {
    start.setUTCDate(1);
  }
  const count = granularity === "week" ? 8 : 6;
  for (let index = count - 1; index >= 0; index -= 1) {
    const cursor = new Date(start);
    if (granularity === "week") {
      cursor.setUTCDate(cursor.getUTCDate() - index * step);
      labels.push(cursor.toISOString().slice(0, 10));
    } else {
      cursor.setUTCMonth(cursor.getUTCMonth() - index);
      labels.push(`${cursor.toISOString().slice(0, 7)}-01`);
    }
  }
  return labels;
}

router.get("/dashboard", async (req, res): Promise<void> => {
  const parsed = GetDashboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid dashboard options." });
    return;
  }

  const { granularity, recentLimit } = parsed.data;

  const [today, week, month, allTime, categoryRows, projectRows, recentRows, trendRows] =
    await Promise.all([
      currencySummary("today"),
      currencySummary("week"),
      currencySummary("month"),
      currencySummary("allTime"),
      db
        .select({
          entityId: categoriesTable.id,
          category: {
            id: categoriesTable.id,
            name: categoriesTable.name,
            icon: categoriesTable.icon,
            color: categoriesTable.color,
            status: categoriesTable.status,
          },
          ...currencyColumns,
          total: currencyAmountSum,
          count: currencyExpenseCount,
        })
        .from(expensesTable)
        .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
        .innerJoin(currenciesTable, expenseCurrencyJoin)
        .where(currentMonth)
        .groupBy(categoriesTable.id, currenciesTable.id)
        .orderBy(desc(sql`sum(${amount})`)),
      db
        .select({
          entityId: projectsTable.id,
          project: {
            id: projectsTable.id,
            name: projectsTable.name,
            color: projectsTable.color,
            status: projectsTable.status,
          },
          ...currencyColumns,
          total: currencyAmountSum,
          count: currencyExpenseCount,
        })
        .from(expensesTable)
        .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
        .innerJoin(currenciesTable, expenseCurrencyJoin)
        .where(currentMonth)
        .groupBy(projectsTable.id, currenciesTable.id)
        .orderBy(desc(sql`sum(${amount})`)),
      db
        .select(expenseSelection)
        .from(expensesTable)
        .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
        .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
        .innerJoin(currenciesTable, expenseCurrencyJoin)
        .orderBy(desc(expensesTable.date), desc(expensesTable.createdAt))
        .limit(recentLimit),
      db.execute(sql`
        select to_char(g, ${granularity === "month" ? "'YYYY-MM-01'" : "'YYYY-MM-DD'"}) as start,
               c.id as "currencyId",
               c.code as "currencyCode",
               c.name as "currencyName",
               c.symbol as "currencySymbol",
               c.decimal_places as "currencyDecimalPlaces",
               c.is_active as "currencyIsActive",
               coalesce(sum(e.amount), 0)::text as total,
               count(e.id)::int as count
        from ${trendSeries(granularity)} as g
        left join expenses e on ${trendJoin(granularity)}
        left join currencies c on e.currency_id = c.id
        where c.id is not null
        group by g, c.id
        order by g
      `),
    ]);

  const recentExpenses = await attachLabels(recentRows);

  const trendsByStart = new Map<string, CurrencyAmount[]>();
  for (const row of trendRows.rows as unknown as Array<CurrencyAggregateRow & { start: string }>) {
    const [entry] = toAmounts([row]);
    trendsByStart.set(row.start, [...(trendsByStart.get(row.start) ?? []), entry]);
  }

  const categorySeen = new Set<string>();
  const categorySpending = categoryRows
    .filter((row) => {
      if (categorySeen.has(row.entityId)) return false;
      categorySeen.add(row.entityId);
      return true;
    })
    .map((row) => {
      const totals = categoryRows
        .filter((candidate) => candidate.entityId === row.entityId)
        .flatMap((candidate) => toAmounts([candidate]));
      return {
        category: row.category,
        totals: withShares(totals, month),
        count: totalCount(totals),
      };
    });

  const projectsSeen = new Set<string | null>();
  const projectSpending = projectRows
    .filter((row) => {
      if (projectsSeen.has(row.entityId)) return false;
      projectsSeen.add(row.entityId);
      return true;
    })
    .map((row) => {
      const totals = projectRows
        .filter((candidate) => candidate.entityId === row.entityId)
        .flatMap((candidate) => toAmounts([candidate]));
      const project = row.project;
      return {
        project: project?.id
          ? {
              id: project.id,
              name: project.name,
              color: project.color,
              status: project.status,
            }
          : null,
        totals: withShares(totals, month),
        count: totalCount(totals),
      };
    });

  res.json(
    GetDashboardResponse.parse({
      summary: { today, week, month, allTime },
      recentExpenses,
      categorySpending,
      projectSpending,
      trend: {
        granularity,
        buckets: trendSpine(granularity).map((start) => {
          const totals = trendsByStart.get(start) ?? [];
          return { start, totals, count: totalCount(totals) };
        }),
      },
    }),
  );
});

function trendSeries(granularity: "day" | "week" | "month") {
  if (granularity === "day") {
    return sql`generate_series(current_date - interval '13 days', current_date, interval '1 day')`;
  }
  if (granularity === "week") {
    return sql`generate_series(date_trunc('week', current_date) - interval '7 weeks', date_trunc('week', current_date), interval '1 week')`;
  }
  return sql`generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month')`;
}

function trendJoin(granularity: "day" | "week" | "month") {
  if (granularity === "day") {
    return sql`e.date = g::date`;
  }
  if (granularity === "week") {
    return sql`e.date >= g::date and e.date < (g + interval '1 week')::date`;
  }
  return sql`e.date >= g::date and e.date < (g + interval '1 month')::date`;
}

export default router;