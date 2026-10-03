import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing parameters.
 *
 * scrypt is used because it ships with Node, so there is no native module to
 * compile on the host and no extra dependency to keep patched. N=2^15 with
 * r=8 needs 128*N*r = 32 MiB, which is above Node's default 32 MiB maxmem, so
 * maxmem is raised explicitly. `PASSWORD_SCRYPT_N` exists so a test run can
 * trade memory hardness for speed; production never sets it.
 */
const SCRYPT_N = Number(process.env.PASSWORD_SCRYPT_N ?? 32768);
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Hashes a password for storage.
 *
 * The returned string is self-describing — `scrypt$N$r$p$salt$digest` — so the
 * parameters can be raised later without invalidating existing hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verifies a password against a stored hash in constant time.
 *
 * Returns false rather than throwing for any malformed or unknown-format hash,
 * so a corrupt row can never be used to distinguish a valid account.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * n * r * 2,
    });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Burns roughly the same time as a real verification.
 *
 * Called when no account matches so that a missing email cannot be detected by
 * measuring how long the endpoint takes to answer.
 */
export async function fakeVerifyDelay(): Promise<void> {
  await scrypt("no-such-account", randomBytes(SALT_LENGTH), KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  }).catch(() => undefined);
}

/**
 * Generates a high-entropy opaque token from the platform CSPRNG.
 *
 * 32 random bytes gives 256 bits of entropy, which is far beyond brute force,
 * so tokens are looked up by digest rather than by a slow hash.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 digest, hex encoded. This is what gets persisted for a token. */
export function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Compares two digests without leaking their contents through timing. */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;
export const RESET_TOKEN_TTL_MINUTES = 30;
export const SESSION_TTL_DAYS = 7;

/**
 * Validates password strength.
 *
 * Length is the dominant factor, so the rule is a generous minimum rather than
 * a composition gauntlet that pushes people toward predictable substitutions.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) return "That password is too long.";
  if (password.normalize("NFKC") !== password) {
    return "Avoid look-alike characters that may have been pasted from elsewhere.";
  }
  const common = [
    "password",
    "12345678",
    "qwertyui",
    "letmein12",
    "iloveyou",
    "admin123",
    "welcome1",
  ];
  const lowered = password.toLowerCase();
  if (common.some((entry) => lowered.includes(entry))) {
    return "That password contains a very common sequence.";
  }
  return null;
}

/** Normalises an email for storage and lookup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}