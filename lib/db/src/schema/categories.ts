import { createInsertSchema } from "drizzle-zod";
import { check, index, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { recordStatusEnum } from "./shared";
import { z } from "zod/v4";

/**
 * WHAT the money was spent on, organised as a two-level hierarchy
 * (parent category -> subcategory).
 *
 * `parentId` is null for a top-level category. Expenses store a single
 * `categoryId` pointing at the leaf (most specific) category; the parent is
 * resolved through this relation. Top-level categories remain selectable so a
 * broad classification is always possible.
 */
export const categoriesTable = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categoriesTable.id, {
      onDelete: "restrict",
    }),
    icon: varchar("icon", { length: 64 }),
    color: varchar("color", { length: 7 }).notNull().default("#6E8E82"),
    status: recordStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("categories_name_unique").on(table.name),
    unique("categories_slug_unique").on(table.slug),
    index("categories_status_idx").on(table.status),
    index("categories_parent_id_idx").on(table.parentId),
    // A category can never be its own parent.
    check("categories_parent_not_self_check", sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
    check("categories_color_hex_check", sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

export const insertCategorySchema = createInsertSchema(categoriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categoriesTable.$inferSelect;