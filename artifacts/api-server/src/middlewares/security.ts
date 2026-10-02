import type { RequestHandler } from "express";

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
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter({
  windowMs,
  max,
  message,
}: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
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
