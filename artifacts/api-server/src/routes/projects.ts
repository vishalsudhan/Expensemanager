import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  ArchiveProjectParams,
  ArchiveProjectResponse,
  CreateProjectBody,
  CreateProjectResponse,
  GetProjectParams,
  GetProjectResponse,
  ListProjectsQueryParams,
  ListProjectsResponse,
  UpdateProjectBody,
  UpdateProjectParams,
  UpdateProjectResponse,
} from "@workspace/api-zod";
import type { Currency, CurrencyAmount } from "@workspace/api-zod";
import {
  categoriesTable,
  currenciesTable,
  db,
  expensesTable,
  projectsTable,
} from "@workspace/db";
import {
  currencyAmountSum,
  currencyColumns,
  currencyExpenseCount,
  totalCount,
} from "../lib/currency-amounts";

const router: IRouter = Router();

const projectColumns = {
  id: projectsTable.id,
  name: projectsTable.name,
  description: projectsTable.description,
  color: projectsTable.color,
  icon: projectsTable.icon,
  status: projectsTable.status,
  defaultCurrencyId: projectsTable.defaultCurrencyId,
  createdAt: projectsTable.createdAt,
  updatedAt: projectsTable.updatedAt,
};

const joinedCurrencySelection = {
  currencyId: currenciesTable.id,
  currencyCode: currenciesTable.code,
  currencyName: currenciesTable.name,
  currencySymbol: currenciesTable.symbol,
  currencyDecimalPlaces: currenciesTable.decimalPlaces,
  currencyIsActive: currenciesTable.isActive,
};

function toCurrency(row: {
  currencyId: string;
  currencyCode: string;
  currencyName: string;
  currencySymbol: string;
  currencyDecimalPlaces: number;
  currencyIsActive: boolean;
}): Currency {
  return {
    id: row.currencyId,
    code: row.currencyCode,
    name: row.currencyName,
    symbol: row.currencySymbol,
    decimalPlaces: row.currencyDecimalPlaces,
    isActive: row.currencyIsActive,
  };
}

function isUniqueConstraintError(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 4) return false;

  const wrappedError = error as { code?: unknown; cause?: unknown };
  if (wrappedError.code === "23505") return true;
  return isUniqueConstraintError(wrappedError.cause, depth + 1);
}

router.get("/projects", async (req, res): Promise<void> => {
  const parsed = ListProjectsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project status filter." });
    return;
  }

  const status = parsed.data.status ?? "active";
  const statusCondition = status === "all" ? undefined : eq(projectsTable.status, status);

  const [projects, totalsRows] = await Promise.all([
    db
      .select({ ...projectColumns, ...joinedCurrencySelection })
      .from(projectsTable)
      .innerJoin(currenciesTable, eq(projectsTable.defaultCurrencyId, currenciesTable.id))
      .where(statusCondition)
      .orderBy(desc(projectsTable.updatedAt), asc(projectsTable.name)),
    db
      .select({
        entityId: expensesTable.projectId,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
      .where(eq(expensesTable.transactionType, "expense"))
      .groupBy(expensesTable.projectId, currenciesTable.id),
  ]);

  const totalsByProject = new Map<string, CurrencyAmount[]>();
  for (const row of totalsRows) {
    if (!row.entityId) continue;
    const list = totalsByProject.get(row.entityId) ?? [];
    list.push({ currency: toCurrency(row), total: String(row.total), count: Number(row.count) });
    totalsByProject.set(row.entityId, list);
  }

  res.json(
    ListProjectsResponse.parse(
      projects.map((project) => {
        const totals = totalsByProject.get(project.id) ?? [];
        return {
          id: project.id,
          name: project.name,
          description: project.description,
          color: project.color,
          icon: project.icon,
          status: project.status,
          defaultCurrency: toCurrency(project),
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          totals: totals.sort((a, b) => a.currency.code.localeCompare(b.currency.code)),
          expenseCount: totalCount(totals),
        };
      }),
    ),
  );
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid project name, default currency, and details." });
    return;
  }

  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Project name cannot be blank." });
    return;
  }

  const { defaultCurrencyId, ...rest } = parsed.data;

  try {
    const [created] = await db
      .insert(projectsTable)
      .values({ ...rest, name, defaultCurrencyId })
      .returning({ id: projectsTable.id });

    const [project] = await db
      .select({ ...projectColumns, ...joinedCurrencySelection })
      .from(projectsTable)
      .innerJoin(currenciesTable, eq(projectsTable.defaultCurrencyId, currenciesTable.id))
      .where(eq(projectsTable.id, created!.id))
      .limit(1);

    res.status(201).json(
      CreateProjectResponse.parse({
        id: project!.id,
        name: project!.name,
        description: project!.description,
        color: project!.color,
        icon: project!.icon,
        status: project!.status,
        defaultCurrency: toCurrency(project!),
        createdAt: project!.createdAt,
        updatedAt: project!.updatedAt,
      }),
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A project with this name already exists." });
      return;
    }
    if (["23503", "23514"].includes(String((error as { code?: string }).code))) {
      res.status(400).json({ error: "Check the selected default currency." });
      return;
    }
    throw error;
  }
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }

  const [project] = await db
    .select({ ...projectColumns, ...joinedCurrencySelection })
    .from(projectsTable)
    .innerJoin(currenciesTable, eq(projectsTable.defaultCurrencyId, currenciesTable.id))
    .where(eq(projectsTable.id, params.data.projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  const [totalsRows, categoryRows, recentExpenses] = await Promise.all([
    db
      .select({ ...currencyColumns, total: currencyAmountSum, count: currencyExpenseCount })
      .from(expensesTable)
      .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
      .where(and(eq(expensesTable.projectId, project.id), eq(expensesTable.transactionType, "expense")))
      .groupBy(currenciesTable.id),
    db
      .select({
        entityId: categoriesTable.id,
        categoryId: categoriesTable.id,
        categoryName: categoriesTable.name,
        categoryColor: categoriesTable.color,
        categoryIcon: categoriesTable.icon,
        ...currencyColumns,
        total: currencyAmountSum,
        count: currencyExpenseCount,
      })
      .from(expensesTable)
      .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
      .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
      .where(and(eq(expensesTable.projectId, project.id), eq(expensesTable.transactionType, "expense")))
      .groupBy(categoriesTable.id, currenciesTable.id)
      .orderBy(desc(sql`sum(${expensesTable.amount})`), asc(categoriesTable.name)),
    db
      .select({
        id: expensesTable.id,
        amount: expensesTable.amount,
        date: expensesTable.date,
        description: expensesTable.description,
        categoryId: categoriesTable.id,
        categoryName: categoriesTable.name,
        categoryColor: categoriesTable.color,
        categoryIcon: categoriesTable.icon,
        paymentMethod: expensesTable.paymentMethod,
        ...joinedCurrencySelection,
      })
      .from(expensesTable)
      .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
      .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
      .where(eq(expensesTable.projectId, project.id))
      .orderBy(desc(expensesTable.date), desc(expensesTable.createdAt))
      .limit(5),
  ]);

  const totals: CurrencyAmount[] = totalsRows
    .map((row) => ({ currency: toCurrency(row), total: String(row.total), count: Number(row.count) }))
    .sort((a, b) => a.currency.code.localeCompare(b.currency.code));

  const categoryTotals = new Map<string, CurrencyAmount[]>();
  const categorySeen = new Set<string>();
  const categoryBreakdown = categoryRows
    .filter((row) => {
      if (categorySeen.has(row.categoryId)) return false;
      categorySeen.add(row.categoryId);
      return true;
    })
    .map((row) => {
      const entryTotals: CurrencyAmount[] = categoryRows
        .filter((candidate) => candidate.categoryId === row.categoryId)
        .map((candidate) => ({
          currency: toCurrency(candidate),
          total: String(candidate.total),
          count: Number(candidate.count),
        }))
        .sort((a, b) => a.currency.code.localeCompare(b.currency.code));
      categoryTotals.set(row.categoryId, entryTotals);
      return {
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        categoryColor: row.categoryColor,
        categoryIcon: row.categoryIcon,
        totals: entryTotals,
        expenseCount: totalCount(entryTotals),
      };
    });

  res.json(
    GetProjectResponse.parse({
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        color: project.color,
        icon: project.icon,
        status: project.status,
        defaultCurrency: toCurrency(project),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      totals,
      expenseCount: totalCount(totals),
      categoryBreakdown,
      recentExpenses: recentExpenses.map((expense) => ({
        id: expense.id,
        amount: String(expense.amount),
        date: expense.date,
        description: expense.description,
        categoryId: expense.categoryId,
        categoryName: expense.categoryName,
        categoryColor: expense.categoryColor,
        categoryIcon: expense.categoryIcon,
        paymentMethod: expense.paymentMethod,
        currency: toCurrency(expense),
      })),
    }),
  );
});

router.patch("/projects/:projectId", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Provide at least one valid project field." });
    return;
  }

  const changes = { ...parsed.data };
  if (changes.name !== undefined) {
    changes.name = changes.name.trim();
    if (!changes.name) {
      res.status(400).json({ error: "Project name cannot be blank." });
      return;
    }
  }

  try {
    const [project] = await db
      .update(projectsTable)
      .set(changes)
      .where(eq(projectsTable.id, params.data.projectId))
      .returning({ id: projectsTable.id });

    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }

    const [updated] = await db
      .select({ ...projectColumns, ...joinedCurrencySelection })
      .from(projectsTable)
      .innerJoin(currenciesTable, eq(projectsTable.defaultCurrencyId, currenciesTable.id))
      .where(eq(projectsTable.id, params.data.projectId))
      .limit(1);

    res.json(
      UpdateProjectResponse.parse({
        id: updated!.id,
        name: updated!.name,
        description: updated!.description,
        color: updated!.color,
        icon: updated!.icon,
        status: updated!.status,
        defaultCurrency: toCurrency(updated!),
        createdAt: updated!.createdAt,
        updatedAt: updated!.updatedAt,
      }),
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A project with this name already exists." });
      return;
    }
    if (["23503", "23514"].includes(String((error as { code?: string }).code))) {
      res.status(400).json({ error: "Check the selected default currency." });
      return;
    }
    throw error;
  }
});

router.patch("/projects/:projectId/archive", async (req, res): Promise<void> => {
  const params = ArchiveProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }

  const [project] = await db
    .update(projectsTable)
    .set({ status: "archived" })
    .where(eq(projectsTable.id, params.data.projectId))
    .returning({ id: projectsTable.id });

  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  const [archived] = await db
    .select({ ...projectColumns, ...joinedCurrencySelection })
    .from(projectsTable)
    .innerJoin(currenciesTable, eq(projectsTable.defaultCurrencyId, currenciesTable.id))
    .where(eq(projectsTable.id, params.data.projectId))
    .limit(1);

  res.json(
    ArchiveProjectResponse.parse({
      id: archived!.id,
      name: archived!.name,
      description: archived!.description,
      color: archived!.color,
      icon: archived!.icon,
      status: archived!.status,
      defaultCurrency: toCurrency(archived!),
      createdAt: archived!.createdAt,
      updatedAt: archived!.updatedAt,
    }),
  );
});

export default router;