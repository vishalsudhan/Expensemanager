import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

/**
 * Single-user account table.
 *
 * This application is deliberately single-tenant: one human owns the data.
 * `password_hash` stores a scrypt digest (never the password), `token_version`
 * is bumped whenever the password changes so every issued session can be
 * invalidated in one statement, and `password_changed_at` gives the password
 * change endpoint a floor to reject logins from before the change.
 */
export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 254 }).notNull(),
    // Encoded as `scrypt$N$r$p$salt$digest`. Never a plaintext password.
    passwordHash: text("password_hash").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    // Incremented on every password change/reset to revoke existing sessions.
    tokenVersion: integer("token_version").notNull().default(1),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Emails are compared case-insensitively, so uniqueness is enforced on the
    // normalised form rather than on the raw column. A unique index over
    // lower(email) is used because a UNIQUE constraint cannot hold an expression.
    uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`),
    check("users_email_not_blank_check", sql`length(trim(${table.email})) > 3`),
    check("users_email_shape_check", sql`${table.email} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`),
    check("users_token_version_positive_check", sql`${table.tokenVersion} >= 1`),
  ],
);

/**
 * Server-side sessions.
 *
 * The cookie carries a high-entropy opaque token; only its SHA-256 digest is
 * stored, so a database leak does not hand over live sessions. Deleting every
 * row for a user logs that user out on all devices at once.
 */
export const sessionsTable = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // SHA-256 digest of the session token. The raw token is never stored.
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    // Copied from the user at issue time; a mismatch invalidates the session.
    tokenVersion: integer("token_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: varchar("user_agent", { length: 400 }),
    ipAddress: varchar("ip_address", { length: 64 }),
  },
  (table) => [
    unique("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
    check("sessions_token_hash_shape_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("sessions_expiry_in_future_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

/**
 * Password reset tokens.
 *
 * Only the SHA-256 digest of the token is stored. Tokens are single-use via
 * `used_at`, time-boxed via `expires_at`, and only the most recent one per user
 * stays live because `usersTable` cascades on delete.
 */
export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // SHA-256 digest of the reset token. The raw token is never stored.
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set the moment the token is redeemed, which makes replay impossible.
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Retained only so a later request can tell the user a reset already ran.
    usedIpAddress: varchar("used_ip_address", { length: 64 }),
  },
  (table) => [
    unique("password_reset_tokens_token_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_id_idx").on(table.userId),
    index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
    check("password_reset_tokens_hash_shape_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("password_reset_tokens_expiry_in_future_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const insertUserSchema = {
  email: z.string().trim().toLowerCase().email().max(254),
  passwordHash: z.string().min(1),
} as const;

export type NewUser = {
  email: string;
  passwordHash: string;
  emailVerified?: boolean;
};

export type User = typeof usersTable.$inferSelect;
export type Session = typeof sessionsTable.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;