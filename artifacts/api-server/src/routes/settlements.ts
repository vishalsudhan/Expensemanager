import { Router, type IRouter } from "express";
import { and, eq, gte, inArray, min, ne, sql } from "drizzle-orm";
import { GetSettlementReportQueryParams, GetSettlementReportResponse } from "@workspace/api-zod";
import type { CurrencyAmount, SettlementPartyRow } from "@workspace/api-zod";
import { counterpartiesTable, currenciesTable, db, expensesTable } from "@workspace/db";
import {
  currencyAmountSum,
  currencyColumns,
  currencyExpenseCount,
  sortByCurrencyCode,
  toCurrency,
} from "../lib/currency-amounts";

const router: IRouter = Router();

type Direction = "reimbursable" | "paid_by_other";

/** Open = not yet settled. Payments never carry a settlement, but are excluded anyway. */
const openSettlement = and(
  ne(expensesTable.settlementType, "none"),
  inArray(expensesTable.settlementStatus, ["pending", "claimed"]),
  eq(expensesTable.transactionType, "expense"),
);

/**
 * Open balances in each direction, per currency. Shared with the dashboard so
 * both screens always agree.
 */
export async function openSettlementTotals(): Promise<Record<Direction, CurrencyAmount[]>> {
  const rows = await db
    .select({
      settlementType: expensesTable.settlementType,
      ...currencyColumns,
      total: currencyAmountSum,
      count: currencyExpenseCount,
    })
    .from(expensesTable)
    .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
    .where(openSettlement)
    .groupBy(expensesTable.settlementType, currenciesTable.id);

  const pick = (direction: Direction) =>
    sortByCurrencyCode(
      rows
        .filter((row) => row.settlementType === direction)
        .map((row) => ({ currency: toCurrency(row), total: String(row.total), count: Number(row.count) })),
    );
  return { reimbursable: pick("reimbursable"), paid_by_other: pick("paid_by_other") };
}

function monthKey(value: string | Date): string {
  const iso = typeof value === "string" ? value : value.toISOString();
  return `${iso.slice(0, 7)}-01`;
}

router.get("/reports/settlements", async (req, res): Promise<void> => {
  const parsed = GetSettlementReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose between 1 and 36 months." });
    return;
  }
  const months = parsed.data.months ?? 12;

  const firstMonth = sql`(date_trunc('month', current_date) - make_interval(months => ${months - 1}))::date`;

  const [totals, partyRows, settledRows] = await Promise.all([
    openSettlementTotals(),
    db
      .select({
        settlementType: expensesTable.settlementType,
        counterpartyId: counterpartiesTable.id,
        counterpartyName: counterpartiesTable.name,
        counterpartyStatus: counterpartiesTable.status,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
        claimedCount: sql<number>`count(*) filter (where ${expensesTable.settlementStatus} = 'claimed')::int`,
        oldestDate: min(expensesTable.date),
        oldestDays: sql<number>`greatest(current_date - min(${expensesTable.date}), 0)::int`,
      })
      .from(expensesTable)
      .innerJoin(counterpartiesTable, eq(expensesTable.counterpartyId, counterpartiesTable.id))
      .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
      .where(openSettlement)
      .groupBy(expensesTable.settlementType, counterpartiesTable.id, currenciesTable.id),
    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${expensesTable.settledOn}), 'YYYY-MM-DD')`,
        settlementType: expensesTable.settlementType,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
      .where(
        and(
          eq(expensesTable.settlementStatus, "settled"),
          eq(expensesTable.transactionType, "expense"),
          gte(expensesTable.settledOn, firstMonth),
        ),
      )
      .groupBy(sql`1`, expensesTable.settlementType, currenciesTable.id),
  ]);

  // One row per person or company, currencies kept apart, oldest first.
  const side = (direction: Direction) => {
    const parties = new Map<string, SettlementPartyRow>();
    for (const row of partyRows.filter((r) => r.settlementType === direction)) {
      const existing = parties.get(row.counterpartyId);
      const amount = { currency: toCurrency(row), total: String(row.total), count: Number(row.count) };
      const oldestDate = String(row.oldestDate);
      if (!existing) {
        parties.set(row.counterpartyId, {
          counterparty: { id: row.counterpartyId, name: row.counterpartyName, status: row.counterpartyStatus },
          totals: [amount],
          count: Number(row.count),
          claimedCount: Number(row.claimedCount),
          oldestDate,
          oldestDays: Number(row.oldestDays),
        });
        continue;
      }
      existing.totals = sortByCurrencyCode([...existing.totals, amount]);
      existing.count += Number(row.count);
      existing.claimedCount += Number(row.claimedCount);
      if (oldestDate < existing.oldestDate) {
        existing.oldestDate = oldestDate;
        existing.oldestDays = Number(row.oldestDays);
      }
    }
    return {
      totals: totals[direction],
      parties: [...parties.values()].sort((a, b) => b.oldestDays - a.oldestDays),
    };
  };

  // Every month in the window, newest first, even when nothing moved.
  const now = new Date();
  const monthly = Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    const month = monthKey(date);
    const amountsFor = (direction: Direction) =>
      sortByCurrencyCode(
        settledRows
          .filter((row) => row.month === month && row.settlementType === direction)
          .map((row) => ({ currency: toCurrency(row), total: String(row.total), count: Number(row.count) })),
      );
    return { month, received: amountsFor("reimbursable"), repaid: amountsFor("paid_by_other") };
  });

  res.json(
    GetSettlementReportResponse.parse({
      owedToMe: side("reimbursable"),
      iOwe: side("paid_by_other"),
      monthly,
    }),
  );
});

export default router;
