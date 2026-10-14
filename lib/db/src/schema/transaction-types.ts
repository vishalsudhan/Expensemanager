import { index, pgEnum, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { recordStatusEnum } from "./shared";

/**
 * Which side of the money a transaction falls on.
 *
 * This is deliberately not user-editable. Every spending total in the app is
 * defined as "expense kinds", because settling a credit-card bill is not new
 * consumption. A reader can add as many transaction types as they like, but
 * each one has to declare which side it belongs to, so a new type joins an
 * existing bucket instead of quietly falling outside every total.
 */
export const transactionTypeKindEnum = pgEnum("transaction_type_kind", ["expense", "payment"]);

export const transactionTypesTable = pgTable(
  "transaction_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    kind: transactionTypeKindEnum("kind").notNull(),
    status: recordStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("transaction_types_name_unique").on(table.name),
    unique("transaction_types_slug_unique").on(table.slug),
    index("transaction_types_status_idx").on(table.status),
    index("transaction_types_kind_idx").on(table.kind),
  ],
);

export type TransactionTypeRecord = typeof transactionTypesTable.$inferSelect;
