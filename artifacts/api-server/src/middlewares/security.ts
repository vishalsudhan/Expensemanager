import type { Request, RequestHandler } from "express";

export function securityHeaders(): RequestHandler {
  const isProduction = process.env.NODE_ENV === "production";

  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    // Personal financial data must not be retained by shared/intermediary caches.
    // The service worker's explicit offline cache is unaffected by this header.
    res.setHeader("Cache-Control", "no-store");

    if (isProduction) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }

    next();
  };
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message: string;
  /**
   * Chooses the bucket key. Defaults to the client address, which is the right
   * choice for general traffic but not for endpoints keyed on an identifier the
   * caller supplies.
   */
  keyBy?: (req: Request) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function createRateLimiter({
  windowMs,
  max,
  message,
  keyBy,
}: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = keyBy ? keyBy(req) : clientKey(req);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (bucket.count >= max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.resetAt - now) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: message });
      return;
    }

    bucket.count += 1;
    next();
  };
}

export const apiRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 600,
  message: "Too many requests. Please slow down and try again shortly.",
});

export const importRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  message: "Too many backup imports. Please wait a minute and try again.",
});

/**
 * Login is limited hard: 10 attempts a minute per client. Brute-forcing a
 * 12+ character password is hopeless anyway, so this exists to blunt online
 * guessing and credential stuffing rather than to make it infeasible.
 */
export const loginRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  message: "Too many sign-in attempts. Please wait a minute and try again.",
});

/**
 * Password reset is limited on two axes, because either alone leaves a hole:
 *
 *  - per client address, so one host cannot spray a list of addresses;
 *  - per submitted address, so many hosts cannot hammer a single account.
 *
 * The per-address limiter can only be mounted on forgot-password, since the
 * redeem endpoint receives a token rather than an email and therefore has no
 * address to key on.
 */
export const resetIpRateLimit = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 12,
  message: "Too many password reset attempts. Please try again later.",
});

/**
 * Redeeming a token gets its own budget rather than sharing the forgot-password
 * one. The two are different problems — spraying addresses versus guessing
 * tokens — and a legitimate user who requests a link and then redeems it should
 * not spend one shared allowance doing both.
 */
export const resetTokenRateLimit = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 12,
  message: "Too many password reset attempts. Please try again later.",
});

export const resetEmailRateLimit = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 5,
  message: "Too many password reset attempts. Please try again later.",
  keyBy: (req) => {
    const body = req.body as { email?: unknown } | undefined;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    // Keying on the address means a caller who omits it cannot bypass the
    // limit by varying the field; they share one bucket instead.
    return `email:${email || "none"}`;
  },
});

/** One-time account setup: a handful of attempts is plenty. */
export const authRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  message: "Too many attempts. Please wait a minute and try again.",
});
