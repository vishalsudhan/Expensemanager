import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { errorText } from '@/lib/format';
import { useAuthState, useLoginMutation, useSetupMutation } from '@/hooks/use-auth';
import { AuthCard, AuthHeading, PasswordInput } from './auth-shell';

/**
 * Sign in.
 *
 * Also renders the one-time setup form while no account exists, so a brand new
 * install can be claimed from the same screen the owner will return to.
 */
export function LoginPage() {
  const { isLoading, needsSetup, authenticated } = useAuthState();
  const [, navigate] = useLocation();

  if (!isLoading && authenticated) {
    navigate('/', { replace: true });
    return null;
  }

  if (!isLoading && needsSetup) {
    return <SetupPage />;
  }

  return <SignInForm />;
}

function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useLoginMutation();
  const [, navigate] = useLocation();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    try {
      await login.mutateAsync({ email: email.trim(), password });
      setPassword('');
      navigate('/', { replace: true });
    } catch {
      // The server's wording is deliberately identical for an unknown address
      // and a wrong password, so this message never leaks account existence.
      setPassword('');
    }
  };

  return (
    <AuthCard>
      <AuthHeading
        eyebrow="WELCOME BACK"
        title="Sign in to Pocketful"
        description="Your expenses are private. Enter your details to continue."
      />

      <form className="space-y-4" onSubmit={onSubmit} data-testid="form-login">
        <div className="space-y-2">
          <Label htmlFor="login-email">Email address</Label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="flex h-12 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="input-login-email"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="login-password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-[12px] font-semibold text-primary hover:underline"
              data-testid="link-forgot-password"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="login-password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            testId="input-login-password"
          />
        </div>

        {login.isError && (
          <p className="text-[13px] text-destructive" data-testid="error-login">
            {errorText(login.error)}
          </p>
        )}

        <Button
          type="submit"
          disabled={login.isPending || !email.trim() || !password}
          className="h-12 w-full gap-2 rounded-xl"
          data-testid="button-submit-login"
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}

/**
 * One-time account setup.
 *
 * Shown only while no account exists; the server refuses a second attempt with
 * 409, so this route cannot be used to replace the owner later.
 */
export function SetupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const setup = useSetupMutation();
  const [, navigate] = useLocation();

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 12;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || password.length < 12 || password !== confirm) return;
    try {
      await setup.mutateAsync({ email: email.trim(), password, confirmPassword: confirm });
      navigate('/', { replace: true });
    } catch {
      // Surfaced below without revealing anything beyond what the server said.
    }
  };

  return (
    <AuthCard>
      <AuthHeading
        eyebrow="FIRST RUN"
        title="Claim this Pocketful"
        description="No account exists yet. Set the email and password you will use to sign in."
      />

      <form className="space-y-4" onSubmit={onSubmit} data-testid="form-setup">
        <div className="space-y-2">
          <Label htmlFor="setup-email">Email address</Label>
          <input
            id="setup-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="flex h-12 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="input-setup-email"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="setup-password">Password</Label>
          <PasswordInput
            id="setup-password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            placeholder="At least 12 characters"
            testId="input-setup-password"
            invalid={tooShort}
          />
          {tooShort && (
            <p className="text-[12px] text-destructive" data-testid="error-setup-password-length">
              Use at least 12 characters.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="setup-confirm">Confirm password</Label>
          <PasswordInput
            id="setup-confirm"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            testId="input-setup-confirm"
            invalid={mismatch}
          />
          {mismatch && (
            <p className="text-[12px] text-destructive" data-testid="error-setup-mismatch">
              Those passwords do not match.
            </p>
          )}
        </div>

        {setup.isError && (
          <p className="text-[13px] text-destructive" data-testid="error-setup">
            {errorText(setup.error)}
          </p>
        )}

        <Button
          type="submit"
          disabled={setup.isPending || !email.trim() || password.length < 12 || mismatch}
          className="h-12 w-full gap-2 rounded-xl"
          data-testid="button-submit-setup"
        >
          {setup.isPending ? 'Setting up…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}