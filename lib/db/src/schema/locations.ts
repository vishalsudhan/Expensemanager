import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { recordStatusEnum } from "./shared";
import { z } from "zod/v4";

/**
 * Where an expense happened (India, Qatar, ...).
 *
 * Locations are deliberately independent of projects, categories and
 * currencies: knowing an expense happened in Qatar says nothing about which
 * currency was used, so no currency is implied or defaulted from a location.
 */
export const locationsTable = pgTable(
  "locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    countryCode: varchar("country_code", { length: 2 }),
    status: recordStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("locations_name_unique").on(table.name),
    unique("locations_slug_unique").on(table.slug),
    index("locations_status_idx").on(table.status),
    check(
      "locations_country_code_check",
      sql`${table.countryCode} is null or ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

export const insertLocationSchema = createInsertSchema(locationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locationsTable.$inferSelect;