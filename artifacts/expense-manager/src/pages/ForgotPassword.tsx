import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { useForgotPassword } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorText } from '@/lib/format';
import { AuthCard, AuthHeading } from './auth-shell';

/**
 * Forgot password.
 *
 * The server answers identically whether or not the address is registered, and
 * this screen shows exactly one message either way. Nothing here reveals
 * whether an account exists, and the token is never displayed.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const mutation = useForgotPassword();
  const [, navigate] = useLocation();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    try {
      await mutation.mutateAsync({ data: { email: email.trim() } });
    } catch {
      // A failed request is shown the same way, so nothing distinguishes a
      // rejected address from an accepted one.
    }
    setSent(true);
  };

  return (
    <AuthCard>
      <AuthHeading
        eyebrow="PASSWORD RECOVERY"
        title="Forgot your password?"
        description="Enter the email address on the account and we will send a link to choose a new one."
      />

      {sent ? (
        <div
          className="rounded-[18px] border border-primary/25 bg-primary/5 p-5"
          data-testid="status-forgot-sent"
        >
          <p className="text-sm font-semibold text-foreground">
            If an account exists for this email, a password reset link has been sent.
          </p>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
            The link works once and expires in 30 minutes. Check your spam folder if it has not
            arrived.
          </p>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} data-testid="form-forgot-password">
          <div className="space-y-2">
            <Label htmlFor="forgot-email">Email address</Label>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="h-12 rounded-xl bg-background"
              data-testid="input-forgot-email"
            />
          </div>
          {mutation.isError && (
            <p className="text-[13px] text-destructive" data-testid="error-forgot-password">
              {errorText(mutation.error)}
            </p>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending || !email.trim()}
            className="h-12 w-full gap-2 rounded-xl"
            data-testid="button-submit-forgot-password"
          >
            {mutation.isPending ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}

      <div className="mt-6 flex flex-col gap-2 border-t border-border/70 pt-5 text-center">
        <Link
          href="/login"
          className="text-[13px] font-semibold text-primary hover:underline"
          data-testid="link-back-to-login"
        >
          Back to sign in
        </Link>
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="text-[13px] text-muted-foreground hover:text-foreground sm:hidden"
        >
          Back
        </button>
      </div>
    </AuthCard>
  );
}