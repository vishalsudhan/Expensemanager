import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { useResetPassword } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { errorText } from '@/lib/format';
import { AuthCard, AuthHeading, PasswordInput } from './auth-shell';

/**
 * Redeem a reset token.
 *
 * The token arrives in the query string of the emailed link. Whether it is
 * valid, expired, already used or simply made up is decided by the server, and
 * this screen shows one message for every failure so the token cannot be
 * probed from the browser.
 */
export function ResetPasswordPage() {
  const [search] = useLocation();
  const token = new URLSearchParams(search).get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const reset = useResetPassword();

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 12;
  const canSubmit = Boolean(token) && password.length >= 12 && !mismatch;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await reset.mutateAsync({ data: { token, password, confirmPassword: confirm } });
      setDone(true);
      setPassword('');
      setConfirm('');
    } catch {
      // The server's wording is identical for every rejection reason.
    }
  };

  if (done) {
    return (
      <AuthCard>
        <AuthHeading
          eyebrow="PASSWORD CHANGED"
          title="Sign in with your new password"
          description="Every signed-in session has been signed out, including this one."
        />
        <Link href="/login">
          <Button className="h-12 w-full gap-2 rounded-xl" data-testid="button-goto-login">
            Go to sign in
          </Button>
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthHeading
        eyebrow="PASSWORD RECOVERY"
        title="Choose a new password"
        description="This link works once. Choosing a new password signs you out everywhere."
      />

      {!token ? (
        <div
          className="rounded-[18px] border border-destructive/25 bg-destructive/5 p-5"
          data-testid="status-reset-no-token"
        >
          <p className="text-sm font-semibold">This link is incomplete.</p>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
            Open the link from your email exactly as it was sent, or request a new one.
          </p>
          <Link href="/forgot-password">
            <Button variant="outline" className="mt-4 h-11 w-full rounded-xl" data-testid="button-request-new-link">
              Request a new link
            </Button>
          </Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} data-testid="form-reset-password">
          <div className="space-y-2">
            <Label htmlFor="reset-password">New password</Label>
            <PasswordInput
              id="reset-password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              placeholder="At least 12 characters"
              testId="input-reset-password"
              invalid={tooShort}
            />
            {tooShort && (
              <p className="text-[12px] text-destructive" data-testid="error-reset-password-length">
                Use at least 12 characters.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reset-confirm">Confirm new password</Label>
            <PasswordInput
              id="reset-confirm"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              testId="input-reset-confirm"
              invalid={mismatch}
            />
            {mismatch && (
              <p className="text-[12px] text-destructive" data-testid="error-reset-mismatch">
                Those passwords do not match.
              </p>
            )}
          </div>

          {reset.isError && (
            <p className="text-[13px] text-destructive" data-testid="error-reset-password">
              {errorText(reset.error)}
            </p>
          )}

          <Button
            type="submit"
            disabled={reset.isPending || !canSubmit}
            className="h-12 w-full gap-2 rounded-xl"
            data-testid="button-submit-reset-password"
          >
            {reset.isPending ? 'Saving…' : 'Set new password'}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}