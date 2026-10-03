import { and, eq, gt, sql } from "drizzle-orm";
import type { RequestHandler } from "express";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { digestToken } from "../lib/crypto";
import { SESSION_COOKIE } from "../lib/session";

/**
 * Resolves the session cookie into `res.locals.session` / `res.locals.user`.
 *
 * A session is only valid when its stored token version still matches the
 * user's, which is how a password change or reset revokes every device at once.
 * Runs on every request so a revoked session cannot be reused before its row
 * is swept.
 */
export const attachSession: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || token.length > 200) {
    next();
    return;
  }

  try {
    const tokenHash = digestToken(token);
    const [row] = await db
      .select({
        sessionId: sessionsTable.id,
        expiresAt: sessionsTable.expiresAt,
        userId: usersTable.id,
        email: usersTable.email,
        passwordHash: usersTable.passwordHash,
        passwordChangedAt: usersTable.passwordChangedAt,
        tokenVersion: usersTable.tokenVersion,
      })
      .from(sessionsTable)
      .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
      .where(
        and(
          eq(sessionsTable.tokenHash, tokenHash),
          gt(sessionsTable.expiresAt, new Date()),
          eq(sessionsTable.tokenVersion, usersTable.tokenVersion),
        ),
      )
      .limit(1);

    if (!row) {
      next();
      return;
    }

    res.locals["session"] = { id: row.sessionId, expiresAt: row.expiresAt };
    res.locals["user"] = {
      id: row.userId,
      email: row.email,
      passwordHash: row.passwordHash,
      passwordChangedAt: row.passwordChangedAt,
      tokenVersion: row.tokenVersion,
    };
    next();
  } catch (error) {
    next(error);
  }
};

/** Blocks a request unless a live session was resolved. */
export const requireAuth: RequestHandler = (_req, res, next) => {
  if (!res.locals["session"]) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  next();
};

/**
 * Removes expired sessions and consumed reset tokens.
 *
 * The tables are tiny for a single-user app, and letting them grow would slowly
 * widen the index scans behind every login.
 */
export const pruneExpiredAuthRows: RequestHandler = async (_req, _res, next) => {
  try {
    await db.execute(sql`delete from sessions where expires_at < now()`);
    await db.execute(
      sql`delete from password_reset_tokens where expires_at < now() - interval '7 days'`,
    );
    next();
  } catch (error) {
    next(error);
  }
};