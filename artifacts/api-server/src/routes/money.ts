import { Router, type IRouter } from "express";
import { and, desc, eq, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { GetMoneyReportQueryParams, GetMoneyReportResponse } from "@workspace/api-zod";
import type {
  MoneyReportCounterpartyTotal,
  MoneyReportCurrencyTotal,
  MoneyReportResponse,
  MoneyReportRow,
} from "@workspace/api-zod";
import {
  categoriesTable,
  currenciesTable,
  db,
  expensesTable,
  locationsTable,
  projectsTable,
} from "@workspace/db";
import { currencyColumns, toCurrency } from "../lib/currency-amounts";
import { directionPaidBy } from "../lib/money-tracking";

const router: IRouter = Router();

/** Rows only carry a status once somebody is named; treat a gap as outstanding. */
const effectiveStatus = sql<"pending" | "settled">`coalesce(${expensesTable.settlementStatus}, 'pending')`;

const amountText = sql<string>`coalesce(sum(${expensesTable.trackedAmount}), 0)::text`.mapWith(String);

router.get("/reports/money", async (req, res) => {
  const parsed = GetMoneyReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a direction and use valid filters." });
    return;
  }
  const {
    direction,
    status,
    from,
    to,
    counterparty,
    projectId,
    locationId,
    currencyId,
    summaryOnly,
  } = parsed.data;

  const conditions: SQL[] = [
    // Money tracking is opt-in, and the direction picks which side of it we want.
    isNotNull(expensesTable.counterparty),
    eq(expensesTable.paidBy, directionPaidBy(direction)),
    // Settling a bill is not itself an owed amount, so payments stay out.
    eq(expensesTable.transactionType, "expense"),
  ];
  if (status) conditions.push(eq(effectiveStatus, status));
  if (from) conditions.push(gte(expensesTable.date, from));
  if (to) conditions.push(lte(expensesTable.date, to));
  if (counterparty?.trim()) conditions.push(eq(expensesTable.counterparty, counterparty.trim()));
  if (projectId) conditions.push(eq(expensesTable.projectId, projectId));
  if (locationId) conditions.push(eq(expensesTable.locationId, locationId));
  if (currencyId) conditions.push(eq(expensesTable.currencyId, currencyId));
  const where = and(...conditions);

  const totalsQuery = db
    .select({
      ...currencyColumns,
      pendingTotal: sql<string>`coalesce(sum(${expensesTable.trackedAmount}) filter (where ${effectiveStatus} = 'pending'), 0)::text`.mapWith(String),
      settledTotal: sql<string>`coalesce(sum(${expensesTable.trackedAmount}) filter (where ${effectiveStatus} = 'settled'), 0)::text`.mapWith(String),
      total: amountText,
      pendingCount: sql<number>`count(*) filter (where ${effectiveStatus} = 'pending')::int`.mapWith(Number),
      settledCount: sql<number>`count(*) filter (where ${effectiveStatus} = 'settled')::int`.mapWith(Number),
      count: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(expensesTable)
    .innerJoin(currenciesTable, eq(currenciesTable.id, expensesTable.currencyId))
    .where(where)
    .groupBy(
      currenciesTable.id,
      currenciesTable.code,
      currenciesTable.name,
      currenciesTable.symbol,
      currenciesTable.decimalPlaces,
      currenciesTable.isActive,
    )
    .orderBy(currenciesTable.code);

  const perCounterpartyQuery = db
    .select({
      counterparty: expensesTable.counterparty,
      ...currencyColumns,
      pendingTotal: sql<string>`coalesce(sum(${expensesTable.trackedAmount}) filter (where ${effectiveStatus} = 'pending'), 0)::text`.mapWith(String),
      settledTotal: sql<string>`coalesce(sum(${expensesTable.trackedAmount}) filter (where ${effectiveStatus} = 'settled'), 0)::text`.mapWith(String),
      pendingCount: sql<number>`count(*) filter (where ${effectiveStatus} = 'pending')::int`.mapWith(Number),
      settledCount: sql<number>`count(*) filter (where ${effectiveStatus} = 'settled')::int`.mapWith(Number),
    })
    .from(expensesTable)
    .innerJoin(currenciesTable, eq(currenciesTable.id, expensesTable.currencyId))
    .where(where)
    .groupBy(expensesTable.counterparty, currenciesTable.id)
    .orderBy(desc(sql`sum(${expensesTable.trackedAmount})`));

  const rowsQuery = db
    .select({
      expenseId: expensesTable.id,
      date: expensesTable.date,
      description: expensesTable.description,
      counterparty: expensesTable.counterparty,
      settlementStatus: effectiveStatus,
      amount: expensesTable.amount,
      trackedAmount: expensesTable.trackedAmount,
      ...currencyColumns,
      locationId: locationsTable.id,
      locationName: locationsTable.name,
      locationSlug: locationsTable.slug,
      locationCountryCode: locationsTable.countryCode,
      locationStatus: locationsTable.status,
      categoryId: categoriesTable.id,
      categoryName: categoriesTable.name,
      categorySlug: categoriesTable.slug,
      categoryParentId: categoriesTable.parentId,
      categoryIcon: categoriesTable.icon,
      categoryColor: categoriesTable.color,
      categoryStatus: categoriesTable.status,
      projectId: projectsTable.id,
      projectName: projectsTable.name,
      projectColor: projectsTable.color,
      projectStatus: projectsTable.status,
    })
    .from(expensesTable)
    .innerJoin(locationsTable, eq(locationsTable.id, expensesTable.locationId))
    .innerJoin(categoriesTable, eq(categoriesTable.id, expensesTable.categoryId))
    .leftJoin(projectsTable, eq(projectsTable.id, expensesTable.projectId))
    .innerJoin(currenciesTable, eq(currenciesTable.id, expensesTable.currencyId))
    .where(where)
    .orderBy(desc(expensesTable.date), desc(expensesTable.createdAt));

  // Name suggestions only need the shape of the data, not every row behind it.
  const [totals, perCounterparty, allRows] = await Promise.all([
    totalsQuery,
    perCounterpartyQuery,
    rowsQuery.then((result) => (summaryOnly ? [] : result)),
  ]);
  const rows: Awaited<typeof rowsQuery> = allRows;

  const summaries: MoneyReportCurrencyTotal[] = totals.map((row) => ({
    currency: toCurrency(row),
    pendingTotal: row.pendingTotal,
    settledTotal: row.settledTotal,
    total: row.total,
    pendingCount: row.pendingCount,
    settledCount: row.settledCount,
    count: row.count,
  }));

  const counterpartyTotals: MoneyReportCounterpartyTotal[] = perCounterparty
    .filter((row): row is typeof row & { counterparty: string } => row.counterparty !== null)
    .map((row) => ({
      counterparty: row.counterparty,
      currency: toCurrency(row),
      pendingTotal: row.pendingTotal,
      settledTotal: row.settledTotal,
      pendingCount: row.pendingCount,
      settledCount: row.settledCount,
    }));

  const reportRows: MoneyReportRow[] = rows
    .filter((row): row is typeof row & { counterparty: string } => row.counterparty !== null)
    .map((row) => ({
      expenseId: row.expenseId,
      date: row.date,
      description: row.description,
      counterparty: row.counterparty,
      settlementStatus: row.settlementStatus,
      amount: String(row.amount),
      trackedAmount: String(row.trackedAmount),
      currency: toCurrency(row),
      category: {
        id: row.categoryId,
        name: row.categoryName,
        slug: row.categorySlug,
        parentId: row.categoryParentId,
        icon: row.categoryIcon,
        color: row.categoryColor,
        status: row.categoryStatus,
      },
      project: row.projectId
        ? {
            id: row.projectId,
            name: row.projectName as string,
            color: row.projectColor as string,
            status: row.projectStatus as "active" | "archived",
          }
        : null,
      location: {
        id: row.locationId,
        name: row.locationName,
        slug: row.locationSlug,
        countryCode: row.locationCountryCode,
        status: row.locationStatus,
      },
    }));

  const payload: MoneyReportResponse = {
    direction,
    summaries,
    rows: reportRows,
    counterpartyTotals,
  };
  res.json(GetMoneyReportResponse.parse(payload));
});

export default router;