import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { recordStatusEnum } from "./shared";
import { z } from "zod/v4";

/**
 * People and companies money is settled with: whoever reimburses an expense
 * (a company, a client) or whoever paid on the user's behalf (a friend).
 * One shared list serves both directions so a name is only ever kept once.
 */
export const counterpartiesTable = pgTable(
  "counterparties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    status: recordStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("counterparties_name_unique").on(table.name),
    index("counterparties_status_idx").on(table.status),
  ],
);

export const insertCounterpartySchema = createInsertSchema(counterpartiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCounterparty = z.infer<typeof insertCounterpartySchema>;
export type Counterparty = typeof counterpartiesTable.$inferSelect;
