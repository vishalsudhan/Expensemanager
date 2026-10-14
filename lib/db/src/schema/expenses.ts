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
import { transactionTypesTable } from "./transaction-types";
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
 * Who put the money up for an expense.
 *
 * `me` is an ordinary expense. `someone_else` is one you owe, which is what
 * makes it show up in the money-to-pay-back report.
 */
export const paidByEnum = pgEnum("paid_by", ["me", "someone_else"]);

/**
 * Whether a tracked amount has changed hands yet.
 *
 * One column rather than separate "received" and "paid back" values, because
 * those are the same fact seen from either side. `paid_by` decides which label
 * the UI shows, so the two can never disagree.
 */
export const settlementStatusEnum = pgEnum("settlement_status", ["pending", "settled"]);

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
    // Expand column for the transaction-type master. The enum above still
    // carries the value; application code reads this one, and the enum is
    // dropped in a later release once nothing depends on it.
    transactionTypeId: uuid("transaction_type_id").references(() => transactionTypesTable.id, {
      onDelete: "restrict",
    }),
    notes: text("notes"),
    // Money tracking. `counterparty` is the opt-in: with none set, these three
    // are unused and the row is an ordinary expense. A settlement updates this
    // row rather than adding one, so it can never double-count.
    paidBy: paidByEnum("paid_by").notNull().default("me"),
    counterparty: text("counterparty"),
    // The amount actually being settled, which may be less than the expense:
    // a 1000 dinner someone owes 600 for tracks 600. Null means not tracked,
    // which is exactly the case where no counterparty is named.
    trackedAmount: numeric("tracked_amount", { precision: 14, scale: 2 }),
    settlementStatus: settlementStatusEnum("settlement_status"),
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
    index("expenses_transaction_type_id_idx").on(table.transactionTypeId),
    index("expenses_amount_idx").on(table.amount),
    index("expenses_counterparty_idx").on(table.counterparty),
    index("expenses_money_tracking_idx")
      .on(table.paidBy, table.settlementStatus)
      .where(sql`${table.counterparty} is not null`),
    index("expenses_settlement_amount_idx")
      .on(table.trackedAmount)
      .where(sql`${table.counterparty} is not null`),
    check("expenses_amount_positive_check", sql`${table.amount} > 0`),
    // A settlement needs somebody to settle it with; this keeps the two in step
    // no matter which client writes them.
    check(
      "expenses_settlement_needs_counterparty_check",
      sql`${table.settlementStatus} is null or ${table.counterparty} is not null`,
    ),
    // A named counterparty means something is tracked; something tracked has
    // an amount. Together these keep the pair from drifting apart.
    check(
      "expenses_tracked_amount_needs_counterparty_check",
      sql`${table.counterparty} is null or ${table.trackedAmount} is not null`,
    ),
    check(
      "expenses_tracked_amount_positive_check",
      sql`${table.trackedAmount} is null or ${table.trackedAmount} > 0`,
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