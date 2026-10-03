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
} from "@workspace/api-zod";
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
import { attachLabels, expenseLabelSelection, expenseSelection } from "../lib/expense-records";
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
      .where(where)
      .orderBy(...expenseOrderBy(sort))
      .limit(limit)
      .offset(offset),
    db
      .select({
        transactionType: expensesTable.transactionType,
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
      .where(where)
      .groupBy(expensesTable.transactionType, currenciesTable.id),
  ]);

  const items = await attachLabels(expenses);

  const toAmounts = (transactionType: "expense" | "payment") =>
    sortByCurrencyCode(
      totalsSummary
        .filter((row) => row.transactionType === transactionType)
        .map((row) => ({
          currency: {
            id: row.currencyId,
            code: row.currencyCode,
            name: row.currencyName,
            symbol: row.currencySymbol,
            decimalPlaces: row.currencyDecimalPlaces,
            isActive: row.currencyIsActive,
          },
          total: String(row.total),
          count: Number(row.count),
        })),
    );

  const totals = toAmounts("expense");
  const paymentTotals = toAmounts("payment");

  // Summing the per-currency counts still yields the exact number of matches.
  const total = totals.reduce((sum, entry) => sum + entry.count, 0);

  res.json(
    ListExpensesResponse.parse({
      items,
      total,
      totals,
      paymentTotals,
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
      res.status(400).json({ error: "Check the selected project, category, labels, currency, location, and amount." });
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
  const { date, transactionType, ...rest } = changes;
  const databaseChanges = {
    // A null transactionType means "leave as-is" rather than "clear it".
    ...rest,
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
      res.status(400).json({ error: "Check the selected project, category, labels, and amount." });
      return;
    }
    throw error;
  }
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