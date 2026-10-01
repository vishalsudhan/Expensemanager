import { relations } from "drizzle-orm";
import { index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { categoriesTable } from "./categories";
import { expensesTable } from "./expenses";
import { labelsTable } from "./labels";
import { projectsTable } from "./projects";

export const expenseLabelsTable = pgTable(
  "expense_labels",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expensesTable.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labelsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.expenseId, table.labelId] }),
    index("expense_labels_label_id_idx").on(table.labelId),
  ],
);

export const expensesRelations = relations(expensesTable, ({ one, many }) => ({
  project: one(projectsTable, {
    fields: [expensesTable.projectId],
    references: [projectsTable.id],
  }),
  category: one(categoriesTable, {
    fields: [expensesTable.categoryId],
    references: [categoriesTable.id],
  }),
  labels: many(expenseLabelsTable),
}));

export const expenseLabelsRelations = relations(expenseLabelsTable, ({ one }) => ({
  expense: one(expensesTable, {
    fields: [expenseLabelsTable.expenseId],
    references: [expensesTable.id],
  }),
  label: one(labelsTable, {
    fields: [expenseLabelsTable.labelId],
    references: [labelsTable.id],
  }),
}));

export const projectsRelations = relations(projectsTable, ({ many }) => ({
  expenses: many(expensesTable),
}));

export const categoriesRelations = relations(categoriesTable, ({ many }) => ({
  expenses: many(expensesTable),
}));

export const labelsRelations = relations(labelsTable, ({ many }) => ({
  expenses: many(expenseLabelsTable),
}));