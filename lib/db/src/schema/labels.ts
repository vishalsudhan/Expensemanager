import { createInsertSchema } from "drizzle-zod";
import { check, index, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { recordStatusEnum } from "./shared";
import { z } from "zod/v4";

export const labelsTable = pgTable(
  "labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    color: varchar("color", { length: 7 }).notNull().default("#C27C68"),
    status: recordStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("labels_name_unique").on(table.name),
    index("labels_status_idx").on(table.status),
    check("labels_color_hex_check", sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

export const insertLabelSchema = createInsertSchema(labelsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLabel = z.infer<typeof insertLabelSchema>;
export type Label = typeof labelsTable.$inferSelect;