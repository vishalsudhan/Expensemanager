import { asc, eq, inArray } from "drizzle-orm";
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

export const expenseSelection = {
  id: expensesTable.id,
  amount: expensesTable.amount,
  date: expensesTable.date,
  projectId: expensesTable.projectId,
  categoryId: expensesTable.categoryId,
  description: expensesTable.description,
  paymentMethod: expensesTable.paymentMethod,
  notes: expensesTable.notes,
  transactionType: expensesTable.transactionType,
  createdAt: expensesTable.createdAt,
  updatedAt: expensesTable.updatedAt,
  location: {
    id: locationsTable.id,
    name: locationsTable.name,
    slug: locationsTable.slug,
    countryCode: locationsTable.countryCode,
    status: locationsTable.status,
  },
  project: {
    id: projectsTable.id,
    name: projectsTable.name,
    color: projectsTable.color,
    status: projectsTable.status,
  },
  category: {
    id: categoriesTable.id,
    name: categoriesTable.name,
    slug: categoriesTable.slug,
    parentId: categoriesTable.parentId,
    icon: categoriesTable.icon,
    color: categoriesTable.color,
    status: categoriesTable.status,
  },
  currency: {
    id: currenciesTable.id,
    code: currenciesTable.code,
    name: currenciesTable.name,
    symbol: currenciesTable.symbol,
    decimalPlaces: currenciesTable.decimalPlaces,
    isActive: currenciesTable.isActive,
  },
};

export const expenseLabelSelection = {
  id: labelsTable.id,
  name: labelsTable.name,
  color: labelsTable.color,
  status: labelsTable.status,
};

export async function attachLabels<T extends { id: string; amount: unknown }>(expenses: T[]) {
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

  return expenses.map((expense) => {
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
}
