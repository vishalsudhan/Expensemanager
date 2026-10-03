import type { ReactNode } from 'react';

/**
 * Shared chrome for the sign-in family of screens, so setup, login, forgot and
 * reset all present the same way. Deliberately renders no navigation: these
 * screens are the only ones reachable without a session.
 */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 text-center">
          <span className="font-display text-[26px] font-semibold tracking-[-0.05em]">
            Pocketful
          </span>
        </div>
        <div className="rounded-[24px] border border-border/70 bg-card p-6 shadow-[0_24px_70px_-50px_var(--hover-shadow)] sm:p-8">
          {children}
        </div>
        <p className="mt-6 text-center text-[11px] uppercase tracking-[.13em] text-muted-foreground">
          Your data stays on your own server
        </p>
      </div>
    </main>
  );
}

export function AuthHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-7">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[.19em] text-primary">
        {eyebrow}
      </div>
      <h1
        className="font-display text-[28px] font-semibold leading-tight tracking-[-.045em]"
        data-testid="heading-auth-title"
      >
        {title}
      </h1>
      <p className="mt-3 text-[13px] leading-6 text-muted-foreground">{description}</p>
    </header>
  );
}

/**
 * A password field with a show/hide toggle, so a long generated passphrase can
 * be checked for typos before it is submitted.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  testId,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  testId: string;
  invalid?: boolean;
}) {
  return (
    <input
      id={id}
      type="password"
      autoComplete={autoComplete}
      required
      value={value}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      className={`flex h-12 w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${
        invalid ? 'border-destructive' : 'border-input'
      }`}
      data-testid={testId}
    />
  );
}