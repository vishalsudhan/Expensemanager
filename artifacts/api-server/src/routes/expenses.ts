import { Router, type IRouter } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  CreateExpenseBody,
  CreateExpenseResponse,
  DeleteExpenseParams,
  GetExpenseParams,
  GetExpenseResponse,
  ListExpensesQueryParams,
  ListExpensesResponse,
  UpdateExpenseBody,
  UpdateExpenseParams,
  UpdateExpenseResponse,
  UpdateExpenseSettlementBody,
  UpdateExpenseSettlementParams,
  UpdateExpenseSettlementResponse,
} from "@workspace/api-zod";
import {
  categoriesTable,
  counterpartiesTable,
  currenciesTable,
  db,
  expenseLabelsTable,
  expensesTable,
  labelsTable,
  locationsTable,
  projectsTable,
} from "@workspace/db";
import { attachLabels, counterpartyJoin, expenseLabelSelection, expenseSelection } from "../lib/expense-records";
import { sortByCurrencyCode } from "../lib/currency-amounts";

const router: IRouter = Router();

function databaseErrorCode(error: unknown, depth = 0): string | null {
  if (typeof error !== "object" || error === null || depth > 4) return null;
  const wrappedError = error as { code?: unknown; cause?: unknown };
  if (typeof wrappedError.code === "string") return wrappedError.code;
  return databaseErrorCode(wrappedError.cause, depth + 1);
}

function isValidAmount(amount: string): boolean {
  return Number.isFinite(Number(amount)) && Number(amount) > 0;
}

function isValidExpenseDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function expenseDateToDatabase(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

type SettlementType = "none" | "reimbursable" | "paid_by_other";
type SettlementStatus = "pending" | "claimed" | "settled";

interface StoredSettlement {
  transactionType: "expense" | "payment";
  settlementType: SettlementType;
  counterpartyId: string | null;
  settlementStatus: SettlementStatus | null;
  settledOn: string | null;
}

interface SettlementChanges {
  transactionType?: "expense" | "payment" | null;
  settlementType?: SettlementType;
  counterpartyId?: string | null;
  settlementStatus?: SettlementStatus | null;
  settledOn?: Date | null;
}

const NO_SETTLEMENT: StoredSettlement = {
  transactionType: "expense",
  settlementType: "none",
  counterpartyId: null,
  settlementStatus: null,
  settledOn: null,
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Merges requested settlement changes onto what is stored and returns the
 * complete, consistent settlement - or a message explaining what is missing.
 * The database CHECK constraint enforces the same rules as a last line.
 */
function resolveSettlement(
  current: StoredSettlement,
  changes: SettlementChanges,
):
  | { ok: true; value: Omit<StoredSettlement, "transactionType"> }
  | { ok: false; error: string } {
  const settlementType = changes.settlementType ?? current.settlementType;
  if (settlementType === "none") {
    return {
      ok: true,
      value: { settlementType, counterpartyId: null, settlementStatus: null, settledOn: null },
    };
  }

  const transactionType = changes.transactionType ?? current.transactionType;
  if (transactionType === "payment") {
    return {
      ok: false,
      error: "A bill payment can't be reimbursable or paid by someone else. Use an expense instead.",
    };
  }

  const sameType = current.settlementType === settlementType;
  const counterpartyId =
    changes.counterpartyId !== undefined ? changes.counterpartyId : current.counterpartyId;
  if (!counterpartyId) {
    return {
      ok: false,
      error:
        settlementType === "reimbursable"
          ? "Choose who will reimburse this expense."
          : "Choose who paid for this expense.",
    };
  }

  const settlementStatus: SettlementStatus =
    changes.settlementStatus ?? (sameType ? current.settlementStatus : null) ?? "pending";
  if (settlementStatus === "claimed" && settlementType !== "reimbursable") {
    return { ok: false, error: "Only reimbursable expenses can be marked as claimed." };
  }

  let settledOn: string | null = null;
  if (settlementStatus === "settled") {
    if (changes.settledOn) {
      if (!isValidExpenseDate(changes.settledOn)) {
        return { ok: false, error: "Enter a valid settlement date." };
      }
      settledOn = expenseDateToDatabase(changes.settledOn);
      // Money can't have come back yet on a later day. One day of slack covers
      // time zones ahead of the server (Doha is UTC+3).
      const latest = new Date();
      latest.setUTCDate(latest.getUTCDate() + 1);
      if (settledOn > latest.toISOString().slice(0, 10)) {
        return { ok: false, error: "The settlement date can't be in the future." };
      }
    } else {
      settledOn = (sameType ? current.settledOn : null) ?? todayIso();
    }
  }

  return { ok: true, value: { settlementType, counterpartyId, settlementStatus, settledOn } };
}

async function loadStoredSettlement(expenseId: string): Promise<StoredSettlement | null> {
  const [row] = await db
    .select({
      transactionType: expensesTable.transactionType,
      settlementType: expensesTable.settlementType,
      counterpartyId: expensesTable.counterpartyId,
      settlementStatus: expensesTable.settlementStatus,
      settledOn: expensesTable.settledOn,
    })
    .from(expensesTable)
    .where(eq(expensesTable.id, expenseId));
  return row ?? null;
}

function hasDuplicateLabelIds(labelIds: string[]): boolean {
  return new Set(labelIds).size !== labelIds.length;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function expenseOrderBy(sort: string): SQL[] {
  switch (sort) {
    case "oldest":
      return [asc(expensesTable.date), asc(expensesTable.createdAt)];
    case "highest":
      return [
        desc(expensesTable.amount),
        desc(expensesTable.date),
        desc(expensesTable.createdAt),
      ];
    case "lowest":
      return [
        asc(expensesTable.amount),
        desc(expensesTable.date),
        desc(expensesTable.createdAt),
      ];
    default:
      return [desc(expensesTable.date), desc(expensesTable.createdAt)];
  }
}

async function getExpenseRecord(expenseId: string) {
  const [expense] = await db
    .select(expenseSelection)
    .from(expensesTable)
    .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
    .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
    .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
    .innerJoin(locationsTable, eq(expensesTable.locationId, locationsTable.id))
    .leftJoin(counterpartiesTable, counterpartyJoin)
    .where(eq(expensesTable.id, expenseId));

  if (!expense) return null;

  const labels = await db
    .select(expenseLabelSelection)
    .from(expenseLabelsTable)
    .innerJoin(labelsTable, eq(expenseLabelsTable.labelId, labelsTable.id))
    .where(eq(expenseLabelsTable.expenseId, expenseId))
    .orderBy(asc(labelsTable.name));

  return {
    ...expense,
    amount: String(expense.amount),
    labelIds: labels.map((label) => label.id),
    labels,
  };
}

router.get("/expenses", async (req, res): Promise<void> => {
  const parsed = ListExpensesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid expense search, filter, or sort options." });
    return;
  }

  const {
    search,
    from,
    to,
    projectId,
    categoryId,
    parentCategoryId,
    labelId,
    paymentMethod,
    currencyId,
    locationId,
    transactionType,
    settlementType,
    settlementStatus,
    counterpartyId,
    sort,
    limit,
    offset,
  } = parsed.data;

  const conditions: SQL[] = [];

  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    const pattern = `%${escapeLikePattern(trimmedSearch)}%`;
    const searchCondition = or(
      ilike(expensesTable.description, pattern),
      ilike(expensesTable.notes, pattern),
      ilike(categoriesTable.name, pattern),
      ilike(projectsTable.name, pattern),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  if (from) conditions.push(gte(expensesTable.date, from));
  if (to) conditions.push(lte(expensesTable.date, to));
  if (projectId) conditions.push(eq(expensesTable.projectId, projectId));
  if (categoryId) conditions.push(eq(expensesTable.categoryId, categoryId));
  if (paymentMethod) conditions.push(eq(expensesTable.paymentMethod, paymentMethod));
  if (currencyId) conditions.push(eq(expensesTable.currencyId, currencyId));
  if (locationId) conditions.push(eq(expensesTable.locationId, locationId));
  if (transactionType) conditions.push(eq(expensesTable.transactionType, transactionType));
  if (settlementType) conditions.push(eq(expensesTable.settlementType, settlementType));
  if (settlementStatus === "open") {
    conditions.push(inArray(expensesTable.settlementStatus, ["pending", "claimed"]));
  } else if (settlementStatus) {
    conditions.push(eq(expensesTable.settlementStatus, settlementStatus));
  }
  if (counterpartyId) conditions.push(eq(expensesTable.counterpartyId, counterpartyId));
  // Read directly: zod's coerce.boolean would turn the string "false" into true.
  const ownCostOnly = req.query["ownCostOnly"] === "true" || req.query["ownCostOnly"] === "1";
  if (ownCostOnly) conditions.push(ne(expensesTable.settlementType, "reimbursable"));
  if (parentCategoryId) {
    // Parent filter matches the parent itself and every subcategory beneath it.
    conditions.push(
      inArray(
        expensesTable.categoryId,
        db
          .select({ id: categoriesTable.id })
          .from(categoriesTable)
          .where(
            or(
              eq(categoriesTable.id, parentCategoryId),
              eq(categoriesTable.parentId, parentCategoryId),
            ),
          ),
      ),
    );
  }

  if (labelId) {
    conditions.push(
      inArray(
        expensesTable.id,
        db
          .select({ id: expenseLabelsTable.expenseId })
          .from(expenseLabelsTable)
          .where(eq(expenseLabelsTable.labelId, labelId)),
      ),
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const [expenses, totalsSummary] = await Promise.all([
    db
      .select(expenseSelection)
      .from(expensesTable)
      .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
      .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
      .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
      .innerJoin(locationsTable, eq(expensesTable.locationId, locationsTable.id))
      .leftJoin(counterpartiesTable, counterpartyJoin)
      .where(where)
      .orderBy(...expenseOrderBy(sort))
      .limit(limit)
      .offset(offset),
    db
      .select({
        transactionType: expensesTable.transactionType,
        settlementType: expensesTable.settlementType,
        currencyId: currenciesTable.id,
        currencyCode: currenciesTable.code,
        currencyName: currenciesTable.name,
        currencySymbol: currenciesTable.symbol,
        currencyDecimalPlaces: currenciesTable.decimalPlaces,
        currencyIsActive: currenciesTable.isActive,
        total: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`.mapWith(String),
        count: count(expensesTable.id),
      })
      .from(expensesTable)
      .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
      .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
      .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
      .innerJoin(locationsTable, eq(expensesTable.locationId, locationsTable.id))
      .leftJoin(counterpartiesTable, counterpartyJoin)
      .where(where)
      .groupBy(expensesTable.transactionType, expensesTable.settlementType, currenciesTable.id),
  ]);

  const items = await attachLabels(expenses);

  // Rows are split by settlement type too, so merge them back per currency.
  // Amounts are summed as whole cents to stay exact.
  type SummaryRow = (typeof totalsSummary)[number];
  const toCents = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  };
  const toAmounts = (keep: (row: SummaryRow) => boolean) => {
    const byCurrency = new Map<string, { row: SummaryRow; cents: bigint; count: number }>();
    for (const row of totalsSummary.filter(keep)) {
      const cents = toCents(String(row.total));
      const existing = byCurrency.get(row.currencyId);
      if (existing) {
        existing.cents += cents;
        existing.count += Number(row.count);
      } else {
        byCurrency.set(row.currencyId, { row, cents, count: Number(row.count) });
      }
    }
    return sortByCurrencyCode(
      [...byCurrency.values()].map(({ row, cents, count }) => ({
        currency: {
          id: row.currencyId,
          code: row.currencyCode,
          name: row.currencyName,
          symbol: row.currencySymbol,
          decimalPlaces: row.currencyDecimalPlaces,
          isActive: row.currencyIsActive,
        },
        total: `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`,
        count,
      })),
    );
  };

  const totals = toAmounts((row) => row.transactionType === "expense");
  const paymentTotals = toAmounts((row) => row.transactionType === "payment");
  const reimbursableTotals = toAmounts(
    (row) => row.transactionType === "expense" && row.settlementType === "reimbursable",
  );

  // Summing the per-currency counts still yields the exact number of matches.
  const total = totals.reduce((sum, entry) => sum + entry.count, 0);

  res.json(
    ListExpensesResponse.parse({
      items,
      total,
      totals,
      paymentTotals,
      reimbursableTotals,
      limit,
      offset,
      hasMore: offset + items.length < total,
    }),
  );
});

/** True when nothing sits beneath this category, i.e. it is safe to file under. */
async function isLeafCategory(categoryId: string): Promise<boolean> {
  const [category] = await db
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(eq(categoriesTable.id, categoryId))
    .limit(1);
  if (!category) return false;
  const [child] = await db
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(eq(categoriesTable.parentId, categoryId))
    .limit(1);
  return !child;
}

router.post("/expenses", async (req, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid amount, date, category, currency, location, and optional expense details." });
    return;
  }

  const data = parsed.data;
  const labelIds = data.labelIds ?? [];
  if (!isValidAmount(data.amount) || !isValidExpenseDate(data.date)) {
    res.status(400).json({ error: "Enter a valid positive amount and calendar date." });
    return;
  }
  if (hasDuplicateLabelIds(labelIds)) {
    res.status(400).json({ error: "Select each label only once." });
    return;
  }

  // An expense always stores the most specific category. A parent that has
  // subcategories is only a grouping label, so filing under it is rejected.
  if (!(await isLeafCategory(data.categoryId))) {
    res.status(400).json({ error: "Choose a subcategory instead of the parent category." });
    return;
  }

  const settlement = resolveSettlement(NO_SETTLEMENT, {
    transactionType: data.transactionType,
    settlementType: data.settlementType,
    counterpartyId: data.counterpartyId,
    settlementStatus: data.settlementStatus,
    settledOn: data.settledOn,
  });
  if (!settlement.ok) {
    res.status(400).json({ error: settlement.error });
    return;
  }

  try {
    const expenseId = await db.transaction(async (tx) => {
      const [expense] = await tx
        .insert(expensesTable)
        .values({
          amount: data.amount,
          date: expenseDateToDatabase(data.date),
          locationId: data.locationId,
          projectId: data.projectId ?? null,
          categoryId: data.categoryId,
          currencyId: data.currencyId,
          description: normalizeOptionalText(data.description),
          paymentMethod: data.paymentMethod ?? null,
          transactionType: data.transactionType ?? "expense",
          notes: normalizeOptionalText(data.notes),
          ...settlement.value,
        })
        .returning({ id: expensesTable.id });

      if (labelIds.length) {
        await tx.insert(expenseLabelsTable).values(
          labelIds.map((labelId) => ({ expenseId: expense.id, labelId })),
        );
      }

      return expense.id;
    });

    const expense = await getExpenseRecord(expenseId);
    if (!expense) {
      res.status(500).json({ error: "The expense was saved but could not be loaded." });
      return;
    }

    res.status(201).json(CreateExpenseResponse.parse(expense));
  } catch (error) {
    if (["23503", "23514"].includes(databaseErrorCode(error) ?? "")) {
      res.status(400).json({ error: "Check the selected project, category, labels, currency, location, person or company, and amount." });
      return;
    }
    throw error;
  }
});

router.get("/expenses/:expenseId", async (req, res): Promise<void> => {
  const params = GetExpenseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid expense ID." });
    return;
  }

  const expense = await getExpenseRecord(params.data.expenseId);
  if (!expense) {
    res.status(404).json({ error: "Expense not found." });
    return;
  }

  res.json(GetExpenseResponse.parse(expense));
});

router.patch("/expenses/:expenseId", async (req, res): Promise<void> => {
  const params = UpdateExpenseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid expense ID." });
    return;
  }

  const parsed = UpdateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter valid expense fields." });
    return;
  }

  const { labelIds, ...changes } = parsed.data;
  if (Object.keys(changes).length === 0 && labelIds === undefined) {
    res.status(400).json({ error: "Provide at least one expense field to update." });
    return;
  }
  if (changes.amount !== undefined && !isValidAmount(changes.amount)) {
    res.status(400).json({ error: "Expense amount must be greater than zero." });
    return;
  }
  if (changes.date !== undefined && !isValidExpenseDate(changes.date)) {
    res.status(400).json({ error: "Enter a valid calendar date." });
    return;
  }
  if (labelIds !== undefined && hasDuplicateLabelIds(labelIds)) {
    res.status(400).json({ error: "Select each label only once." });
    return;
  }
  // Re-pointing an expense at a grouping parent would lose the detail, so the
  // same leaf rule that guards creation applies when the category changes.
  if (changes.categoryId !== undefined && !(await isLeafCategory(changes.categoryId))) {
    res.status(400).json({ error: "Choose a subcategory instead of the parent category." });
    return;
  }

  if (changes.description !== undefined) {
    changes.description = normalizeOptionalText(changes.description);
  }
  if (changes.notes !== undefined) {
    changes.notes = normalizeOptionalText(changes.notes);
  }
  const {
    date,
    transactionType,
    settlementType,
    counterpartyId,
    settlementStatus,
    settledOn,
    ...rest
  } = changes;

  // Settlement fields are resolved together against what is stored, so a
  // partial update can never leave them half-filled.
  const touchesSettlement =
    settlementType !== undefined ||
    counterpartyId !== undefined ||
    settlementStatus !== undefined ||
    settledOn !== undefined ||
    (transactionType !== undefined && transactionType !== null);
  let settlementChanges = {};
  if (touchesSettlement) {
    const stored = await loadStoredSettlement(params.data.expenseId);
    if (!stored) {
      res.status(404).json({ error: "Expense not found." });
      return;
    }
    const resolved = resolveSettlement(stored, {
      transactionType,
      settlementType,
      counterpartyId,
      settlementStatus,
      settledOn,
    });
    if (!resolved.ok) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    settlementChanges = resolved.value;
  }

  const databaseChanges = {
    // A null transactionType means "leave as-is" rather than "clear it".
    ...rest,
    ...settlementChanges,
    ...(transactionType !== undefined && transactionType !== null ? { transactionType } : {}),
    ...(date !== undefined ? { date: expenseDateToDatabase(date) } : {}),
  };

  try {
    const updated = await db.transaction(async (tx) => {
      const [expense] = await tx
        .update(expensesTable)
        .set(databaseChanges)
        .where(eq(expensesTable.id, params.data.expenseId))
        .returning({ id: expensesTable.id });

      if (!expense) return false;

      if (labelIds !== undefined) {
        await tx
          .delete(expenseLabelsTable)
          .where(eq(expenseLabelsTable.expenseId, expense.id));

        if (labelIds.length) {
          await tx.insert(expenseLabelsTable).values(
            labelIds.map((labelId) => ({ expenseId: expense.id, labelId })),
          );
        }
      }

      return true;
    });

    if (!updated) {
      res.status(404).json({ error: "Expense not found." });
      return;
    }

    const expense = await getExpenseRecord(params.data.expenseId);
    if (!expense) {
      res.status(404).json({ error: "Expense not found." });
      return;
    }

    res.json(UpdateExpenseResponse.parse(expense));
  } catch (error) {
    if (["23503", "23514"].includes(databaseErrorCode(error) ?? "")) {
      res.status(400).json({ error: "Check the selected project, category, labels, person or company, and amount." });
      return;
    }
    throw error;
  }
});

/**
 * Moves only the settlement along (claimed, settled, reopened). The expense's
 * own amount and date are never touched, so past months never change.
 */
router.patch("/expenses/:expenseId/settlement", async (req, res): Promise<void> => {
  const params = UpdateExpenseSettlementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid expense ID." });
    return;
  }
  const parsed = UpdateExpenseSettlementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose pending, claimed, or settled, with an optional date." });
    return;
  }

  const stored = await loadStoredSettlement(params.data.expenseId);
  if (!stored) {
    res.status(404).json({ error: "Expense not found." });
    return;
  }
  if (stored.settlementType === "none") {
    res.status(400).json({ error: "This expense isn't reimbursable or paid by someone else." });
    return;
  }

  // Settling without a date means today, never an older stored date.
  const settledOn =
    parsed.data.status === "settled" ? (parsed.data.settledOn ?? new Date(`${todayIso()}T00:00:00Z`)) : null;
  const resolved = resolveSettlement(stored, { settlementStatus: parsed.data.status, settledOn });
  if (!resolved.ok) {
    res.status(400).json({ error: resolved.error });
    return;
  }

  await db
    .update(expensesTable)
    .set(resolved.value)
    .where(eq(expensesTable.id, params.data.expenseId));

  const expense = await getExpenseRecord(params.data.expenseId);
  if (!expense) {
    res.status(404).json({ error: "Expense not found." });
    return;
  }
  res.json(UpdateExpenseSettlementResponse.parse(expense));
});

router.delete("/expenses/:expenseId", async (req, res): Promise<void> => {
  const params = DeleteExpenseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid expense ID." });
    return;
  }

  const [expense] = await db
    .delete(expensesTable)
    .where(eq(expensesTable.id, params.data.expenseId))
    .returning({ id: expensesTable.id });

  if (!expense) {
    res.status(404).json({ error: "Expense not found." });
    return;
  }

  res.status(204).send();
});

export default router;