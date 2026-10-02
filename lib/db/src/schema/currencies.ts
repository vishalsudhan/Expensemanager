import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const currenciesTable = pgTable(
  "currencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 3 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    symbol: varchar("symbol", { length: 8 }).notNull(),
    decimalPlaces: integer("decimal_places").notNull().default(2),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("currencies_code_unique").on(table.code),
    index("currencies_is_active_idx").on(table.isActive),
    check("currencies_code_check", sql`${table.code} ~ '^[A-Z]{3}$'`),
    check(
      "currencies_decimal_places_check",
      sql`${table.decimalPlaces} >= 0 and ${table.decimalPlaces} <= 4`,
    ),
  ],
);

export const insertCurrencySchema = createInsertSchema(currenciesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCurrency = z.infer<typeof insertCurrencySchema>;
export type Currency = typeof currenciesTable.$inferSelect;
