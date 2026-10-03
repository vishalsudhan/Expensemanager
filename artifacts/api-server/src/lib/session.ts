import type { Response } from "express";
import { SESSION_TTL_DAYS } from "./crypto";

/**
 * Session cookie handling.
 *
 * The cookie carries an opaque random token; the database only ever sees its
 * SHA-256 digest. `httpOnly` keeps it away from JavaScript, `sameSite=lax`
 * survives a normal top-level navigation from an email link while blocking
 * cross-site POSTs, and `secure` is set whenever the app is not on plain HTTP
 * localhost.
 */

export const SESSION_COOKIE = "pocketful_session";

function basePath(): string {
  return (process.env.BASE_PATH ?? "/").replace(/\/$/, "");
}

export function setSessionCookie(res: Response, token: string, maxAgeMs?: number): void {
  // Express treats cookie `maxAge` as milliseconds and converts it to Max-Age
  // seconds itself, so this must not be passed in seconds.
  const maxAge = maxAgeMs ?? SESSION_TTL_DAYS * 86_400_000;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `${basePath()}/`,
    maxAge,
  });
}

export function clearSessionCookie(res: Response): void {
  // The attributes must match those used when setting it, or the browser keeps
  // the original cookie.
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `${basePath()}/`,
  });
}