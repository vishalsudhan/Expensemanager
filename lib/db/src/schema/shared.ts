import { pgEnum } from "drizzle-orm/pg-core";

export const recordStatusEnum = pgEnum("record_status", ["active", "archived"]);