import { logger } from "./logger";

/**
 * Outbound email.
 *
 * Delivery goes through the Resend HTTP API using a plain fetch call, so there
 * is no provider SDK to install or keep patched. The API key is read only from
 * the server environment and is never referenced by the web app, so it cannot
 * leak into the browser bundle.
 *
 * When no key is configured — local development, CI — the message is written
 * to the server log instead of being sent. That keeps the whole reset flow
 * testable without an account, and it is the reason the reset link is logged
 * rather than emailed in those environments.
 *
 * RESEND_ENDPOINT is overridable so an automated run can stand up a local
 * stand-in for the provider and read the reset link that way round, which
 * exercises the real delivery path rather than a bypass.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type EmailResult =
  | { delivered: true; provider: "resend" }
  | { delivered: false; provider: "resend" | "log"; reason: string };

const RESEND_ENDPOINT = process.env.RESEND_ENDPOINT?.trim() || "https://api.resend.com/emails";
const DEFAULT_FROM = "Pocketful <onboarding@resend.dev>";

function apiKey(): string | undefined {
  const key = process.env.RESEND_API_KEY?.trim();
  return key ? key : undefined;
}

/**
 * The origin the reset link points at.
 *
 * `WEB_APP_URL` is optional on purpose: the app is served from a Vercel domain
 * that is not guaranteed to stay the same, so the fallback asks the request
 * itself for its own origin rather than assuming a particular hostname.
 */
export function resetLinkOrigin(requestOrigin: string | undefined): string {
  const configured = process.env.WEB_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (requestOrigin) return requestOrigin;
  return "http://localhost:19111";
}

/** Builds the link the user clicks. The token travels in the query string. */
export function buildResetLink(origin: string | undefined, token: string): string {
  return `${resetLinkOrigin(origin)}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const key = apiKey();

  if (!key) {
    // Never log the recipient's address or the token on a shared log sink.
    logger.warn(
      { subject: message.subject, to: "<redacted>", body: message.text },
      "RESEND_API_KEY is not configured; email written to the log instead of sent",
    );
    return { delivered: false, provider: "log", reason: "RESEND_API_KEY is not configured" };
  }

  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!response.ok) {
      // The provider's payload may echo the recipient, so log the status only.
      const detail = await response.text().catch(() => "");
      logger.error(
        { status: response.status, detail: detail.slice(0, 500) },
        "email provider rejected the message",
      );
      return { delivered: false, provider: "resend", reason: `provider responded ${response.status}` };
    }

    return { delivered: true, provider: "resend" };
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "email provider request failed",
    );
    return { delivered: false, provider: "resend", reason: "provider request failed" };
  }
}

/** The password-reset message. It never contains the password itself. */
export function passwordResetEmail(input: {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}): EmailMessage {
  return {
    to: input.to,
    subject: "Reset your Pocketful password",
    text: [
      "Someone asked to reset the password for this Pocketful account.",
      "",
      `Open this link to choose a new password:`,
      input.resetUrl,
      "",
      `The link works once and expires in ${input.expiresInMinutes} minutes.`,
      "",
      "If this was not you, no action is needed and your current password still works.",
      "You can also reset it later from the login screen.",
    ].join("\n"),
  };
}