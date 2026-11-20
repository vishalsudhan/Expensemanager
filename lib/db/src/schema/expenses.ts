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
import { counterpartiesTable } from "./counterparties";
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

/**
 * Who carries the cost in the end.
 *
 * - none: the user paid and keeps the cost (every expense before this existed).
 * - reimbursable: the user paid, and a counterparty will pay it back.
 * - paid_by_other: a counterparty paid on the user's behalf; the user owes them.
 *
 * In every case the expense stays a real expense, dated when it happened, so a
 * later repayment never rewrites the history of an earlier month.
 */
export const settlementTypeEnum = pgEnum("settlement_type", [
  "none",
  "reimbursable",
  "paid_by_other",
]);

/** claimed only applies to reimbursable; settled always carries settled_on. */
export const settlementStatusEnum = pgEnum("settlement_status", [
  "pending",
  "claimed",
  "settled",
]);

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
    settlementType: settlementTypeEnum("settlement_type").notNull().default("none"),
    counterpartyId: uuid("counterparty_id").references(() => counterpartiesTable.id, {
      onDelete: "restrict",
    }),
    settlementStatus: settlementStatusEnum("settlement_status"),
    settledOn: date("settled_on", { mode: "string" }),
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
    index("expenses_settlement_idx").on(table.settlementType, table.settlementStatus),
    index("expenses_counterparty_id_idx").on(table.counterpartyId),
    check("expenses_amount_positive_check", sql`${table.amount} > 0`),
    check(
      "expenses_settlement_consistency_check",
      sql`(${table.settlementType} = 'none' AND ${table.counterpartyId} IS NULL AND ${table.settlementStatus} IS NULL AND ${table.settledOn} IS NULL)
        OR (${table.settlementType} <> 'none' AND ${table.counterpartyId} IS NOT NULL AND ${table.settlementStatus} IS NOT NULL
            AND (${table.settlementStatus} = 'settled') = (${table.settledOn} IS NOT NULL)
            AND (${table.settlementStatus} <> 'claimed' OR ${table.settlementType} = 'reimbursable'))`,
    ),
  ],
);

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;