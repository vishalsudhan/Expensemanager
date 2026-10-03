import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  passwordResetTokensTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import {
  digestToken,
  fakeVerifyDelay,
  generateToken,
  hashPassword,
  normalizeEmail,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RESET_TOKEN_TTL_MINUTES,
  safeEqualHex,
  SESSION_TTL_DAYS,
  validatePasswordStrength,
  verifyPassword,
} from "../lib/crypto";
import { buildResetLink, passwordResetEmail, sendEmail } from "../lib/email";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/auth";
import { SESSION_COOKIE, setSessionCookie, clearSessionCookie } from "../lib/session";

const router: IRouter = Router();

/** The same answer whether or not the address is registered. */
const FORGOT_PASSWORD_RESPONSE =
  "If an account exists for this email, a password reset link has been sent.";

/** Same wording for every rejection reason, so a token cannot be probed. */
const RESET_FAILURE =
  "This reset link is no longer valid. Request a new one to continue.";

function requestOrigin(req: { headers: Record<string, unknown> }): string | undefined {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) return origin;
  const host = req.headers.host;
  if (typeof host === "string" && host) {
    const proto = req.headers["x-forwarded-proto"];
    return `${typeof proto === "string" && proto ? proto : "https"}://${host}`;
  }
  return undefined;
}

async function countUsers(): Promise<number> {
  const [row] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  return row ? 1 : 0;
}

/** Removes sessions that have aged out. Cheap enough to run opportunistically. */
async function pruneExpiredSessions(): Promise<void> {
  await db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, new Date()));
}

/**
 * GET /auth/state
 *
 * Lets the web app decide between the one-time setup screen and the login
 * screen without either being guessable from the API alone.
 */
router.get("/auth/state", async (_req, res): Promise<void> => {
  const needsSetup = (await countUsers()) === 0;
  res.json({ needsSetup, authenticated: Boolean(res.locals["session"]) });
});

/**
 * POST /auth/setup
 *
 * Creates the single account. Permanently refused once a user exists, so the
 * provisioning route cannot be used to add or replace an account later.
 */
router.post("/auth/setup", async (req, res): Promise<void> => {
  if ((await countUsers()) > 0) {
    res.status(409).json({ error: "This account is already set up." });
    return;
  }

  const email = typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const confirm = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if (password !== confirm) {
    res.status(400).json({ error: "Those passwords do not match." });
    return;
  }
  const weakness = validatePasswordStrength(password);
  if (weakness) {
    res.status(400).json({ error: weakness });
    return;
  }

  const passwordHash = await hashPassword(password);
  try {
    const [user] = await db
      .insert(usersTable)
      .values({ email, passwordHash, emailVerified: true })
      .returning({ id: usersTable.id, tokenVersion: usersTable.tokenVersion });

    const session = await issueSession(user.id, user.tokenVersion, req);
    setSessionCookie(res, session.token);
    res.status(201).json({ ok: true, email });
  } catch (error) {
    // A concurrent setup request can win the race; the unique index decides.
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "This account is already set up." });
      return;
    }
    throw error;
  }
});

/**
 * POST /auth/login
 */
router.post("/auth/login", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  const [user] = await db
    .select({
      id: usersTable.id,
      passwordHash: usersTable.passwordHash,
      tokenVersion: usersTable.tokenVersion,
    })
    .from(usersTable)
    .where(eq(sql`lower(${usersTable.email})`, email))
    .limit(1);

  if (!user) {
    // Spend comparable time so a missing account is not detectable by latency.
    await fakeVerifyDelay();
    res.status(401).json({ error: "That email and password do not match." });
    return;
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    await fakeVerifyDelay();
    res.status(401).json({ error: "That email and password do not match." });
    return;
  }

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  const session = await issueSession(user.id, user.tokenVersion, req);
  setSessionCookie(res, session.token);
  res.json({ ok: true });
});

/** POST /auth/logout — drops only the calling session. */
router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = readSessionToken(req);
  if (token) {
    await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, digestToken(token)));
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** GET /auth/me */
router.get("/auth/me", requireAuth, async (_req, res): Promise<void> => {
  res.json({
    user: {
      id: res.locals["user"].id,
      email: res.locals["user"].email,
      passwordChangedAt: res.locals["user"].passwordChangedAt,
    },
  });
});

/**
 * POST /auth/forgot-password
 *
 * Always answers with the same body and status, so the response cannot be used
 * to discover which addresses are registered.
 */
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(sql`lower(${usersTable.email})`, email))
    .limit(1);

  if (user) {
    try {
      await issueResetToken(user.id, req);
    } catch (error) {
      // Delivery problems must not change the response, or they become an
      // oracle for whether the address exists.
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "failed to issue a password reset token",
      );
    }
  } else {
    await fakeVerifyDelay();
  }

  res.json({ message: FORGOT_PASSWORD_RESPONSE });
});

/**
 * POST /auth/reset-password
 *
 * Validates a token, replaces the password, revokes every session, and burns
 * the token so it cannot be replayed.
 */
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const confirm = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";

  if (!token || token.length > 200) {
    res.status(400).json({ error: RESET_FAILURE });
    return;
  }
  if (password !== confirm) {
    res.status(400).json({ error: "Those passwords do not match." });
    return;
  }
  const weakness = validatePasswordStrength(password);
  if (weakness) {
    res.status(400).json({ error: weakness });
    return;
  }

  const tokenHash = digestToken(token);
  const [row] = await db
    .select({
      id: passwordResetTokensTable.id,
      userId: passwordResetTokensTable.userId,
      tokenHash: passwordResetTokensTable.tokenHash,
    })
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.tokenHash, tokenHash))
    .limit(1);

  // Same response for unknown, expired and already-used tokens.
  const genericFailure = () => {
    res.status(400).json({ error: RESET_FAILURE });
  };

  if (!row || !safeEqualHex(row.tokenHash, tokenHash)) {
    await fakeVerifyDelay();
    genericFailure();
    return;
  }

  // Single-use and time-boxed, both enforced in one conditional update so two
  // simultaneous redemptions cannot both succeed.
  const [claimed] = await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date(), usedIpAddress: readIp(req) })
    .where(
      and(
        eq(passwordResetTokensTable.id, row.id),
        isNull(passwordResetTokensTable.usedAt),
        sql`${passwordResetTokensTable.expiresAt} > now()`,
      ),
    )
    .returning({ userId: passwordResetTokensTable.userId });

  if (!claimed) {
    await fakeVerifyDelay();
    genericFailure();
    return;
  }

  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    // Bumping token_version invalidates every session issued under the old
    // password, everywhere, without needing to enumerate them.
    await tx
      .update(usersTable)
      .set({
        passwordHash,
        passwordChangedAt: new Date(),
        tokenVersion: sql`${usersTable.tokenVersion} + 1`,
      })
      .where(eq(usersTable.id, claimed.userId));
    await tx.delete(sessionsTable).where(eq(sessionsTable.userId, claimed.userId));
    // Any other outstanding reset links are void once the password changes.
    await tx
      .delete(passwordResetTokensTable)
      .where(
        and(
          eq(passwordResetTokensTable.userId, claimed.userId),
          isNull(passwordResetTokensTable.usedAt),
        ),
      );
  });

  clearSessionCookie(res);
  res.json({ ok: true, message: "Your password has been changed. Sign in with it now." });
});

/**
 * POST /auth/change-password
 *
 * Requires the current password, then revokes every session including this one
 * so the user must sign in again on this device too.
 */
router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const password = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  const confirm = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";

  const user = res.locals["user"] as { id: string; passwordHash: string; tokenVersion: number };

  if (currentPassword.length > PASSWORD_MAX_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    res.status(400).json({ error: "That password is too long." });
    return;
  }
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    res.status(400).json({ error: "Your current password is not correct." });
    return;
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    res.status(400).json({ error: `Use at least ${PASSWORD_MIN_LENGTH} characters.` });
    return;
  }
  if (password !== confirm) {
    res.status(400).json({ error: "Those passwords do not match." });
    return;
  }
  if (currentPassword === password) {
    res.status(400).json({ error: "Choose a password you have not used here before." });
    return;
  }
  const weakness = validatePasswordStrength(password);
  if (weakness) {
    res.status(400).json({ error: weakness });
    return;
  }

  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({
        passwordHash,
        passwordChangedAt: new Date(),
        tokenVersion: sql`${usersTable.tokenVersion} + 1`,
      })
      .where(eq(usersTable.id, user.id));
    await tx.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
    // Void any outstanding reset link. Without this, a reset email captured
    // before the change would still be redeemable afterwards, which defeats
    // the point of changing the password in response to a suspected compromise.
    await tx
      .delete(passwordResetTokensTable)
      .where(
        and(
          eq(passwordResetTokensTable.userId, user.id),
          isNull(passwordResetTokensTable.usedAt),
        ),
      );
  });

  clearSessionCookie(res);
  res.json({ ok: true, message: "Password changed. Sign in again with your new password." });
});

// ---------------------------------------------------------------- helpers

function readSessionToken(req: { cookies?: Record<string, string> }): string | undefined {
  return req.cookies?.[SESSION_COOKIE];
}

function readIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string | null {
  const raw = req.ip ?? req.socket?.remoteAddress ?? "";
  // Sessions and tokens record the address for audit; keep it to a length the
  // column accepts so a long proxy header cannot break the write.
  return raw ? String(raw).slice(0, 64) : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

async function issueSession(
  userId: string,
  tokenVersion: number,
  req: { headers: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } },
): Promise<{ token: string; expiresAt: Date }> {
  await pruneExpiredSessions();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  const userAgent = req.headers["user-agent"];
  await db.insert(sessionsTable).values({
    userId,
    tokenHash: digestToken(token),
    tokenVersion,
    expiresAt,
    userAgent: typeof userAgent === "string" ? userAgent.slice(0, 400) : null,
    ipAddress: readIp(req),
  });
  return { token, expiresAt };
}

/**
 * Issues a reset token.
 *
 * Any outstanding unused token for the user is deleted first, so only the most
 * recent link works and a leaked older email cannot be used.
 */
async function issueResetToken(
  userId: string,
  req: { headers: Record<string, unknown> },
): Promise<void> {
  await db
    .delete(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.userId, userId),
        isNull(passwordResetTokensTable.usedAt),
      ),
    );

  const token = generateToken();
  await db.insert(passwordResetTokensTable).values({
    userId,
    tokenHash: digestToken(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
  });

  const [user] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (user?.email) {
    await sendEmail(
      passwordResetEmail({
        to: user.email,
        resetUrl: buildResetLink(requestOrigin(req), token),
        expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
      }),
    );
  }
}

export default router;