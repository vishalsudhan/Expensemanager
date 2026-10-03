import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { categoriesTable } from "./categories";
import { currenciesTable } from "./currencies";
import { locationsTable } from "./locations";
import { projectsTable } from "./projects";
import { z } from "zod/v4";

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "credit_card",
  "debit_card",
  "bank_transfer",
  "upi",
  "other",
]);

/**
 * Distinguishes real consumption from settling a debt.
 *
 * A credit-card purchase and the later bill payment that clears it are two
 * rows but only one spending event, so `payment` rows are excluded from
 * spending totals. This is a reporting flag only - no double-entry bookkeeping.
 */
export const transactionTypeEnum = pgEnum("transaction_type", ["expense", "payment"]);

export const expensesTable = pgTable(
  "expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    date: date("date", { mode: "string" }).notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locationsTable.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projectsTable.id, {
      onDelete: "set null",
    }),
    // Points at the leaf category; the parent is resolved via categories.parent_id.
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categoriesTable.id, { onDelete: "restrict" }),
    currencyId: uuid("currency_id")
      .notNull()
      .references(() => currenciesTable.id, { onDelete: "restrict" }),
    description: text("description"),
    paymentMethod: paymentMethodEnum("payment_method"),
    transactionType: transactionTypeEnum("transaction_type").notNull().default("expense"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("expenses_date_idx").on(table.date),
    index("expenses_location_id_idx").on(table.locationId),
    index("expenses_project_id_idx").on(table.projectId),
    index("expenses_project_id_date_idx").on(table.projectId, table.date),
    index("expenses_category_id_idx").on(table.categoryId),
    index("expenses_category_date_idx").on(table.categoryId, table.date),
    index("expenses_currency_id_idx").on(table.currencyId),
    index("expenses_transaction_type_idx").on(table.transactionType),
    index("expenses_amount_idx").on(table.amount),
    check("expenses_amount_positive_check", sql`${table.amount} > 0`),
  ],
);

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;