import { Router, type IRouter } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  lt,
  sql,
} from "drizzle-orm";
import {
  ArchiveCategoryParams,
  ArchiveCategoryResponse,
  CreateCategoryBody,
  CreateCategoryResponse,
  GetCategoryParams,
  GetCategoryResponse,
  ListCategoriesQueryParams,
  ListCategoriesResponse,
  UpdateCategoryBody,
  UpdateCategoryParams,
  UpdateCategoryResponse,
} from "@workspace/api-zod";
import { categoriesTable, currenciesTable, db, expensesTable } from "@workspace/db";
import {
  currencyAmountSum,
  currencyColumns,
  currencyExpenseCount,
  totalCount,
} from "../lib/currency-amounts";
import type { CurrencyAmount } from "@workspace/api-zod";

const router: IRouter = Router();

const expenseCurrencyJoin = eq(expensesTable.currencyId, currenciesTable.id);

function toAmounts(rows: {
  currencyId: string;
  currencyCode: string;
  currencyName: string;
  currencySymbol: string;
  currencyDecimalPlaces: number;
  currencyIsActive: boolean;
  total: string;
  count: number;
}[]): CurrencyAmount[] {
  return rows
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
    }))
    .sort((a, b) => a.currency.code.localeCompare(b.currency.code));
}

function isUniqueConstraintError(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 4) return false;

  const wrappedError = error as { code?: unknown; cause?: unknown };
  if (wrappedError.code === "23505") return true;
  return isUniqueConstraintError(wrappedError.cause, depth + 1);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

router.get("/categories", async (req, res): Promise<void> => {
  const parsed = ListCategoriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid category search or status filter." });
    return;
  }

  const status = parsed.data.status ?? "active";
  const conditions = [];
  if (status !== "all") {
    conditions.push(eq(categoriesTable.status, status));
  }
  const search = parsed.data.search?.trim();
  if (search) {
    conditions.push(ilike(categoriesTable.name, `%${escapeLikePattern(search)}%`));
  }

  const categories = await db
    .select({
      id: categoriesTable.id,
      name: categoriesTable.name,
      icon: categoriesTable.icon,
      color: categoriesTable.color,
      status: categoriesTable.status,
      createdAt: categoriesTable.createdAt,
      updatedAt: categoriesTable.updatedAt,
    })
    .from(categoriesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(categoriesTable.name));

  const totalsRows = await db
    .select({
      entityId: expensesTable.categoryId,
      ...currencyColumns,
      total: currencyAmountSum,
      count: currencyExpenseCount,
    })
    .from(expensesTable)
    .innerJoin(currenciesTable, expenseCurrencyJoin)
    .groupBy(expensesTable.categoryId, currenciesTable.id);

  const totalsByCategory = new Map<string, CurrencyAmount[]>();
  for (const row of totalsRows) {
    const list = totalsByCategory.get(row.entityId) ?? [];
    list.push({ currency: toAmounts([row])[0].currency, total: String(row.total), count: Number(row.count) });
    totalsByCategory.set(row.entityId, list);
  }

  res.json(
    ListCategoriesResponse.parse(
      categories.map((category) => {
        const totals = totalsByCategory.get(category.id) ?? [];
        return {
          ...category,
          totals: totals.sort((a, b) => a.currency.code.localeCompare(b.currency.code)),
          expenseCount: totalCount(totals),
        };
      }),
    ),
  );
});

router.post("/categories", async (req, res): Promise<void> => {
  const parsed = CreateCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid category name, icon, and color." });
    return;
  }

  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Category name cannot be blank." });
    return;
  }

  try {
    const [category] = await db
      .insert(categoriesTable)
      .values({ ...parsed.data, name })
      .returning();

    res.status(201).json(CreateCategoryResponse.parse(category));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A category with this name already exists." });
      return;
    }
    throw error;
  }
});

router.get("/categories/:categoryId", async (req, res): Promise<void> => {
  const params = GetCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid category ID." });
    return;
  }

  const [category] = await db
    .select()
    .from(categoriesTable)
    .where(eq(categoriesTable.id, params.data.categoryId))
    .limit(1);

  if (!category) {
    res.status(404).json({ error: "Category not found." });
    return;
  }

  const [totalsRows, recentExpenses] = await Promise.all([
    db
      .select({ ...currencyColumns, total: currencyAmountSum, count: currencyExpenseCount })
      .from(expensesTable)
      .innerJoin(currenciesTable, expenseCurrencyJoin)
      .where(eq(expensesTable.categoryId, category.id))
      .groupBy(currenciesTable.id),
    db
      .select({
        id: expensesTable.id,
        amount: expensesTable.amount,
        date: expensesTable.date,
        description: expensesTable.description,
      })
      .from(expensesTable)
      .where(eq(expensesTable.categoryId, category.id))
      .orderBy(desc(expensesTable.date), desc(expensesTable.createdAt))
      .limit(5),
  ]);

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const months = Array.from({ length: 6 }, (_, index) => {
    const monthStart = new Date(Date.UTC(currentYear, currentMonth - 5 + index, 1));
    const nextMonthStart = new Date(Date.UTC(currentYear, currentMonth - 4 + index, 1));
    const month = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}`;

    return {
      month,
      startDate: monthStart.toISOString().slice(0, 10),
      nextMonthStart: nextMonthStart.toISOString().slice(0, 10),
    };
  });

  const monthlyTotals = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${expensesTable.date}::date), 'YYYY-MM')`,
      ...currencyColumns,
      total: currencyAmountSum,
      count: currencyExpenseCount,
    })
    .from(expensesTable)
    .innerJoin(currenciesTable, expenseCurrencyJoin)
    .where(
      and(
        eq(expensesTable.categoryId, category.id),
        gte(expensesTable.date, months[0].startDate),
        lt(expensesTable.date, months[months.length - 1].nextMonthStart),
      ),
    )
    .groupBy(
      sql`date_trunc('month', ${expensesTable.date}::date)`,
      currenciesTable.id,
    )
    .orderBy(asc(sql`date_trunc('month', ${expensesTable.date}::date)`));

  const totalsByMonth = new Map<string, CurrencyAmount[]>();
  for (const entry of monthlyTotals) {
    const [amount] = toAmounts([entry]);
    totalsByMonth.set(entry.month, [...(totalsByMonth.get(entry.month) ?? []), amount]);
  }

  const monthlySpending = months.map(({ month }) => {
    const totals = totalsByMonth.get(month) ?? [];
    return {
      month,
      totals: totals.sort((a, b) => a.currency.code.localeCompare(b.currency.code)),
      expenseCount: totalCount(totals),
    };
  });

  const totals = toAmounts(totalsRows);

  res.json(
    GetCategoryResponse.parse({
      category,
      totals,
      expenseCount: totalCount(totals),
      recentExpenses: recentExpenses.map((expense) => ({
        ...expense,
        amount: String(expense.amount),
      })),
      monthlySpending,
    }),
  );
});

router.patch("/categories/:categoryId", async (req, res): Promise<void> => {
  const params = UpdateCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid category ID." });
    return;
  }

  const parsed = UpdateCategoryBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Provide at least one valid category field." });
    return;
  }

  const changes = { ...parsed.data };
  if (changes.name !== undefined) {
    changes.name = changes.name.trim();
    if (!changes.name) {
      res.status(400).json({ error: "Category name cannot be blank." });
      return;
    }
  }

  try {
    const [category] = await db
      .update(categoriesTable)
      .set(changes)
      .where(eq(categoriesTable.id, params.data.categoryId))
      .returning();

    if (!category) {
      res.status(404).json({ error: "Category not found." });
      return;
    }

    res.json(UpdateCategoryResponse.parse(category));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A category with this name already exists." });
      return;
    }
    throw error;
  }
});

router.patch("/categories/:categoryId/archive", async (req, res): Promise<void> => {
  const params = ArchiveCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid category ID." });
    return;
  }

  const [category] = await db
    .update(categoriesTable)
    .set({ status: "archived" })
    .where(eq(categoriesTable.id, params.data.categoryId))
    .returning();

  if (!category) {
    res.status(404).json({ error: "Category not found." });
    return;
  }

  res.json(ArchiveCategoryResponse.parse(category));
});

export default router;