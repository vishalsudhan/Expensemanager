import { Router, type IRouter } from "express";
import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  CreateExpenseBody,
  CreateExpenseResponse,
  DeleteExpenseParams,
  GetExpenseParams,
  GetExpenseResponse,
  ListExpensesResponse,
  UpdateExpenseBody,
  UpdateExpenseParams,
  UpdateExpenseResponse,
} from "@workspace/api-zod";
import {
  categoriesTable,
  db,
  expenseLabelsTable,
  expensesTable,
  labelsTable,
  projectsTable,
} from "@workspace/db";

const router: IRouter = Router();

const expenseSelection = {
  id: expensesTable.id,
  amount: expensesTable.amount,
  date: expensesTable.date,
  projectId: expensesTable.projectId,
  categoryId: expensesTable.categoryId,
  description: expensesTable.description,
  paymentMethod: expensesTable.paymentMethod,
  notes: expensesTable.notes,
  createdAt: expensesTable.createdAt,
  updatedAt: expensesTable.updatedAt,
  project: {
    id: projectsTable.id,
    name: projectsTable.name,
    color: projectsTable.color,
    status: projectsTable.status,
  },
  category: {
    id: categoriesTable.id,
    name: categoriesTable.name,
    icon: categoriesTable.icon,
    color: categoriesTable.color,
    status: categoriesTable.status,
  },
};

const expenseLabelSelection = {
  id: labelsTable.id,
  name: labelsTable.name,
  color: labelsTable.color,
  status: labelsTable.status,
};

function databaseErrorCode(error: unknown, depth = 0): string | null {
  if (typeof error !== "object" || error === null || depth > 4) return null;
  const wrappedError = error as { code?: unknown; cause?: unknown };
  if (typeof wrappedError.code === "string") return wrappedError.code;
  return databaseErrorCode(wrappedError.cause, depth + 1);
}

function isValidAmount(amount: string): boolean {
  return Number.isFinite(Number(amount)) && Number(amount) > 0;
}

function isValidExpenseDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function hasDuplicateLabelIds(labelIds: string[]): boolean {
  return new Set(labelIds).size !== labelIds.length;
}

async function getExpenseRecord(expenseId: string) {
  const [expense] = await db
    .select(expenseSelection)
    .from(expensesTable)
    .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
    .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
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

router.get("/expenses", async (_req, res): Promise<void> => {
  const expenses = await db
    .select(expenseSelection)
    .from(expensesTable)
    .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
    .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
    .orderBy(desc(expensesTable.date), desc(expensesTable.createdAt));

  const expenseIds = expenses.map((expense) => expense.id);
  const labelRows = expenseIds.length
    ? await db
        .select({
          expenseId: expenseLabelsTable.expenseId,
          ...expenseLabelSelection,
        })
        .from(expenseLabelsTable)
        .innerJoin(labelsTable, eq(expenseLabelsTable.labelId, labelsTable.id))
        .where(inArray(expenseLabelsTable.expenseId, expenseIds))
        .orderBy(asc(labelsTable.name))
    : [];

  const labelsByExpenseId = new Map<string, typeof labelRows>();
  for (const labelRow of labelRows) {
    const currentLabels = labelsByExpenseId.get(labelRow.expenseId) ?? [];
    currentLabels.push(labelRow);
    labelsByExpenseId.set(labelRow.expenseId, currentLabels);
  }

  const response = expenses.map((expense) => {
    const labels = (labelsByExpenseId.get(expense.id) ?? []).map(
      ({ expenseId: _expenseId, ...label }) => label,
    );
    return {
      ...expense,
      amount: String(expense.amount),
      labelIds: labels.map((label) => label.id),
      labels,
    };
  });

  res.json(ListExpensesResponse.parse(response));
});

router.post("/expenses", async (req, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid amount, date, category, and optional expense details." });
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

  try {
    const expenseId = await db.transaction(async (tx) => {
      const [expense] = await tx
        .insert(expensesTable)
        .values({
          amount: data.amount,
          date: data.date,
          projectId: data.projectId ?? null,
          categoryId: data.categoryId,
          description: normalizeOptionalText(data.description),
          paymentMethod: data.paymentMethod ?? null,
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
      res.status(400).json({ error: "Check the selected project, category, labels, and amount." });
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

  if (changes.description !== undefined) {
    changes.description = normalizeOptionalText(changes.description);
  }
  if (changes.notes !== undefined) {
    changes.notes = normalizeOptionalText(changes.notes);
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const [expense] = await tx
        .update(expensesTable)
        .set(changes)
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