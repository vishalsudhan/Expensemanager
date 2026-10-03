import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  KeyRound,
  LogOut,
  MapPin,
  Plus,
  DatabaseBackup,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  useChangePassword, useCreateLocation, useGetCurrentUser, useImportBackup,
  useListCurrencies, useListLocations, useLogout, useUpdateCurrency,
  useUpdateLocation,
} from '@workspace/api-client-react';
import type { BackupDocument, BackupImportResult } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { errorText } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ThemeControl } from '@/components/theme-control';

const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

function importErrorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const body = data as { error?: unknown; details?: unknown };
      const base = typeof body.error === 'string' ? body.error : undefined;
      const details = Array.isArray(body.details)
        ? body.details.filter((detail): detail is string => typeof detail === 'string')
        : [];
      if (base) return details.length ? `${base} ${details[0]}` : base;
      if (details.length) return details.join(' ');
    }
    if ('error' in error && typeof (error as { error?: unknown }).error === 'string') {
      return (error as { error: string }).error;
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

async function downloadFromApi(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(path, { headers: { accept: '*/*' } });
  if (!response.ok) throw new Error('Could not prepare that download. Please try again.');
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = match?.[1] ?? fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

const csvExports = [
  { key: 'expenses', label: 'Expenses', path: '/api/export/expenses', description: 'Every expense with its category, project, labels, and notes.' },
  { key: 'projects', label: 'Projects', path: '/api/export/projects', description: 'Your projects with description, color, and status.' },
  { key: 'categories', label: 'Categories', path: '/api/export/categories', description: 'Your categories with icon, color, and status.' },
  { key: 'labels', label: 'Labels', path: '/api/export/labels', description: 'Your labels with color and status.' },
] as const;

function ImportSummary({ summary }: { summary: BackupImportResult }) {
  const rows = [
    { label: 'Projects', count: summary.projects },
    { label: 'Categories', count: summary.categories },
    { label: 'Labels', count: summary.labels },
    { label: 'Expenses', count: summary.expenses },
  ];
  return (
    <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/5 p-4" data-testid="status-import-result">
      <div className="flex items-center gap-2 text-primary">
        <CheckCircle2 size={16} />
        <span className="text-sm font-bold">Backup imported</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label} className="rounded-xl bg-card/70 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted-foreground">{row.label}</div>
            <div className="mt-1 font-display text-lg font-semibold">
              {row.count.created}
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">new</span>
            </div>
            {(row.count.updated > 0 || row.count.skipped > 0) && (
              <div className="text-[11px] text-muted-foreground">
                {row.count.updated} updated{row.count.skipped > 0 ? ` · ${row.count.skipped} matched` : ''}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">
        {summary.expenseLabels} expense-label {summary.expenseLabels === 1 ? 'link' : 'links'} applied. Nothing was deleted.
      </p>
      {summary.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-muted-foreground">
          {summary.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const importBackup = useImportBackup();
  const currenciesQuery = useListCurrencies();
  const updateCurrency = useUpdateCurrency();
  const locationsQuery = useListLocations({ status: 'all' });
  const updateLocation = useUpdateLocation();
  const createLocation = useCreateLocation();
  const [newLocationName, setNewLocationName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [summary, setSummary] = useState<BackupImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currencies = [...(currenciesQuery.data ?? [])].sort((a, b) =>
    a.code.localeCompare(b.code),
  );

  const toggleCurrency = (currencyId: string, isActive: boolean) => {
    updateCurrency.mutate(
      { currencyId, data: { isActive } },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries();
          toast({
            title: isActive ? 'Currency enabled' : 'Currency disabled',
            description: isActive
              ? 'It is available again for new expenses and project defaults.'
              : 'Amounts already recorded in it are untouched.',
          });
        },
        onError: (mutationError) =>
          toast({
            title: 'Could not update currency',
            description: errorText(mutationError),
            variant: 'destructive',
          }),
      },
    );
  };

  const toggleLocation = (locationId: string, isActive: boolean) => {
    // Locations are never deleted; disabling only hides them from new expenses.
    updateLocation.mutate(
      { locationId, data: { status: isActive ? 'archived' : 'active' } },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries();
          toast({
            title: isActive ? 'Location disabled' : 'Location enabled',
            description: isActive
              ? 'Amounts already recorded there are untouched.'
              : 'It is available again for new expenses.',
          });
        },
        onError: (mutationError) =>
          toast({
            title: 'Could not update location',
            description: errorText(mutationError),
            variant: 'destructive',
          }),
      },
    );
  };

  const addLocation = () => {
    const name = newLocationName.trim();
    if (!name) return;
    createLocation.mutate(
      { data: { name } },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries();
          setNewLocationName('');
          toast({ title: 'Location added', description: `${name} is ready to use.` });
        },
        onError: (mutationError) =>
          toast({
            title: 'Could not add location',
            description: errorText(mutationError),
            variant: 'destructive',
          }),
      },
    );
  };

  const currentUser = useGetCurrentUser();
  const changePassword = useChangePassword();
  const logout = useLogout();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChanged, setPasswordChanged] = useState(false);

  const securityMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const securityTooShort = newPassword.length > 0 && newPassword.length < 12;
  const securityReady =
    Boolean(currentPassword) && newPassword.length >= 12 && !securityMismatch;

  // A password change revokes every session, including this one, so the app
  // returns to the login screen rather than silently continuing.
  const submitPasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!securityReady) return;
    try {
      await changePassword.mutateAsync({
        data: {
          currentPassword,
          newPassword,
          confirmPassword,
        },
      });
    } catch {
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordChanged(true);
    queryClient.clear();
    window.location.assign(
      `${import.meta.env.BASE_URL.replace(/\/$/, '')}/login`,
    );
  };

  const signOut = async () => {
    await logout.mutateAsync();
    queryClient.clear();
    window.location.assign(
      `${import.meta.env.BASE_URL.replace(/\/$/, '')}/login`,
    );
  };

  const runDownload = async (key: string, path: string, fallbackName: string) => {
    setDownloading(key);
    try {
      await downloadFromApi(path, fallbackName);
      toast({ title: 'Download ready', description: `${fallbackName} is on its way to your downloads.` });
    } catch (downloadError) {
      toast({
        title: 'Could not export',
        description: importErrorText(downloadError),
        variant: 'destructive',
      });
    } finally {
      setDownloading(null);
    }
  };

  const runImport = async () => {
    setSummary(null);
    setError(null);
    if (!selectedFile) {
      setError('Choose a backup file first.');
      return;
    }
    if (selectedFile.size > MAX_BACKUP_BYTES) {
      setError('That file is larger than 25 MB. Choose a smaller backup.');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await selectedFile.text());
    } catch {
      setError('That file is not valid JSON. Choose a Pocketful backup (.json).');
      return;
    }

    importBackup.mutate(
      { data: parsed as BackupDocument },
      {
        onSuccess: async (result) => {
          setSummary(result);
          setFileName('');
          setSelectedFile(null);
          if (fileRef.current) fileRef.current.value = '';
          await queryClient.invalidateQueries();
          toast({ title: 'Backup imported', description: 'Your data has been merged successfully.' });
        },
        onError: (importFailure) => {
          const message = importErrorText(importFailure);
          setError(message);
          toast({ title: 'Could not import backup', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const busy = importBackup.isPending;

  return (
    <div className="page-enter">
      <div className="mb-8 text-[10px] font-bold uppercase tracking-[0.19em] text-primary">MAKE IT YOURS</div>
      <div className="max-w-[760px] border-b border-border/80 pb-8 sm:pb-10">
        <div className="mb-5 grid size-12 place-items-center rounded-[16px] bg-secondary text-primary">
          <DatabaseBackup size={22} strokeWidth={1.7} />
        </div>
        <h1 className="font-display text-[40px] font-semibold leading-none tracking-[-0.055em] sm:text-[52px]" data-testid="heading-settings">
          Settings
        </h1>
        <p className="mt-4 max-w-[520px] text-[14px] leading-6 text-muted-foreground sm:text-[15px]">
          Your data belongs to you. Export a spreadsheet for any list, keep a complete backup, or restore one you made earlier.
        </p>
      </div>

      <section className="mt-8 max-w-[760px]">
        <div className="flex flex-col gap-4 rounded-[20px] border border-border/70 bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.03em]">Appearance</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Use a light or dark look, or follow your device setting.</p>
          </div>
          <ThemeControl />
        </div>
      </section>

      <section className="mt-8 max-w-[760px]" data-testid="section-locations">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-accent/70 text-accent-foreground">
            <MapPin size={18} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.03em]" data-testid="heading-locations-settings">
              Locations
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Where your spending happened. A location never implies a currency and never implies a project.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-[20px] border border-border/70 bg-card">
          {locationsQuery.isLoading ? (
            <div className="space-y-2 p-4" data-testid="status-locations-loading">
              {[0, 1].map((row) => (
                <Skeleton key={row} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : locationsQuery.isError ? (
            <div className="px-5 py-8 text-center" data-testid="status-locations-error">
              <p className="text-sm text-muted-foreground">Locations couldn’t be loaded.</p>
              <Button onClick={() => locationsQuery.refetch()} variant="outline" className="mt-4 gap-2" data-testid="button-retry-locations">
                <RotateCcw size={14} /> Try again
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/60" data-testid="list-locations">
              {(locationsQuery.data ?? []).map((location) => (
                <li key={location.id} className="flex items-center justify-between gap-4 px-5 py-3.5" data-testid={`row-location-${location.slug}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-secondary text-primary">
                      <MapPin size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-display text-[15px] font-semibold tracking-[-0.02em]" data-testid={`text-location-${location.slug}-name`}>
                        {location.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {location.countryCode ?? 'No country code'}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${location.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`} data-testid={`status-location-${location.slug}`}>
                      {location.status === 'active' ? 'Active' : 'Disabled'}
                    </span>
                    <Button
                      variant="outline"
                      disabled={updateLocation.isPending}
                      onClick={() => toggleLocation(location.id, location.status === 'active')}
                      className="h-9 rounded-xl px-3 text-[11px]"
                      data-testid={`button-toggle-location-${location.slug}`}
                    >
                      {location.status === 'active' ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            addLocation();
          }}
        >
          <Input
            value={newLocationName}
            onChange={(event) => setNewLocationName(event.target.value)}
            placeholder="Add a location, e.g. UAE"
            aria-label="New location name"
            maxLength={80}
            className="h-11 min-w-[220px] flex-1 rounded-xl bg-card"
            data-testid="input-new-location"
          />
          <Button type="submit" disabled={createLocation.isPending} className="h-11 gap-2 rounded-xl" data-testid="button-add-location">
            <Plus size={15} /> Add location
          </Button>
        </form>
      </section>

      <section className="mt-8 max-w-[760px]" data-testid="section-currencies">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-accent/70 text-accent-foreground">
            <Coins size={18} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.03em]" data-testid="heading-currencies">
              Currencies
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Every expense keeps its own currency. Totals are grouped per currency and nothing is converted.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-[20px] border border-border/70 bg-card">
          {currenciesQuery.isLoading ? (
            <div className="space-y-2 p-4" data-testid="status-currencies-loading">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : currenciesQuery.isError ? (
            <div className="px-5 py-8 text-center" data-testid="status-currencies-error">
              <p className="text-sm text-muted-foreground">Currencies couldn’t be loaded.</p>
              <Button onClick={() => currenciesQuery.refetch()} variant="outline" className="mt-4 gap-2" data-testid="button-retry-currencies">
                <RotateCcw size={14} /> Try again
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/60" data-testid="list-currencies">
              {currencies.map((currency) => (
                <li
                  key={currency.id}
                  className="flex items-center justify-between gap-4 px-5 py-3.5"
                  data-testid={`row-currency-${currency.code}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-secondary font-display text-[15px] font-semibold text-primary">
                      {currency.symbol}
                    </span>
                    <div className="min-w-0">
                      <p className="font-display text-[15px] font-semibold tracking-[-0.02em]" data-testid={`text-currency-${currency.code}-name`}>
                        {currency.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid={`text-currency-${currency.code}-meta`}>
                        {currency.code} · {currency.decimalPlaces} decimal {currency.decimalPlaces === 1 ? 'place' : 'places'}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                        currency.isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      }`}
                      data-testid={`status-currency-${currency.code}`}
                    >
                      {currency.isActive ? 'Active' : 'Disabled'}
                    </span>
                    <Button
                      variant="outline"
                      disabled={updateCurrency.isPending}
                      onClick={() => toggleCurrency(currency.id, !currency.isActive)}
                      className="h-9 rounded-xl px-3 text-[11px]"
                      data-testid={`button-toggle-currency-${currency.code}`}
                    >
                      {currency.isActive ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
          Disabling a currency keeps every amount already recorded in it. It only removes the currency from new
          entries and project defaults.
        </p>
      </section>

      <section className="mt-8 max-w-[760px]" data-testid="section-security">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-accent/70 text-accent-foreground">
            <KeyRound size={18} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.03em]" data-testid="heading-security">
              Security
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Signed in as{' '}
              <span className="font-semibold text-foreground">
                {currentUser.data?.user?.email ?? ''}
              </span>
            </p>
          </div>
        </div>

        <form
          className="mt-4 space-y-4 rounded-[20px] border border-border/70 bg-card p-5"
          onSubmit={submitPasswordChange}
          data-testid="form-change-password"
        >
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="h-11 rounded-xl bg-background"
              data-testid="input-current-password"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="At least 12 characters"
              aria-invalid={securityTooShort || undefined}
              className="h-11 rounded-xl bg-background"
              data-testid="input-new-password"
            />
            {securityTooShort && (
              <p className="text-[12px] text-destructive" data-testid="error-new-password-length">
                Use at least 12 characters.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">Confirm new password</Label>
            <Input
              id="confirm-new-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-invalid={securityMismatch || undefined}
              className="h-11 rounded-xl bg-background"
              data-testid="input-confirm-new-password"
            />
            {securityMismatch && (
              <p className="text-[12px] text-destructive" data-testid="error-new-password-mismatch">
                Those passwords do not match.
              </p>
            )}
          </div>

          {changePassword.isError && (
            <p className="text-[13px] text-destructive" data-testid="error-change-password">
              {errorText(changePassword.error)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              type="submit"
              disabled={changePassword.isPending || !securityReady}
              className="h-11 gap-2 rounded-xl"
              data-testid="button-change-password"
            >
              {changePassword.isPending ? 'Updating…' : 'Change password'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={logout.isPending}
              onClick={signOut}
              className="h-11 gap-2 rounded-xl"
              data-testid="button-sign-out"
            >
              <LogOut size={15} /> Sign out
            </Button>
          </div>

          <p className="text-[12px] leading-5 text-muted-foreground">
            Changing your password signs you out on every device, including this one.
          </p>
        </form>
      </section>

      <section className="mt-8 max-w-[760px]">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-accent/70 text-accent-foreground">
            <FileSpreadsheet size={18} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.03em]">Spreadsheet exports</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Download a CSV you can open in Excel, Numbers, or Google Sheets.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {csvExports.map((item) => (
            <div key={item.key} className="flex flex-col justify-between rounded-[20px] border border-border/70 bg-card px-5 py-4">
              <div>
                <p className="font-display text-[16px] font-semibold tracking-[-0.02em]">{item.label}</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{item.description}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => runDownload(item.key, item.path, `pocketful-${item.key}.csv`)}
                disabled={downloading === item.key}
                className="mt-4 h-10 w-full gap-2 rounded-xl"
                data-testid={`button-export-${item.key}`}
              >
                {downloading === item.key ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
                Export {item.label.toLowerCase()} CSV
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 max-w-[760px]">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-accent/70 text-accent-foreground">
            <ShieldCheck size={18} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.03em]">Complete backup</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              A single file with projects, categories, labels, expenses, and their label links.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-[22px] border border-border/70 bg-card px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-[16px] font-semibold tracking-[-0.02em]">Download your backup</p>
              <p className="mt-1 max-w-[420px] text-[12px] leading-5 text-muted-foreground">
                Keep this JSON file somewhere safe. It preserves every identifier, so restoring is exact.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => runDownload('backup', '/api/backup', 'pocketful-backup.json')}
              disabled={downloading === 'backup'}
              className="h-11 shrink-0 gap-2 rounded-xl px-5"
              data-testid="button-download-backup"
            >
              {downloading === 'backup' ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
              Download backup
            </Button>
          </div>

          <div className="mt-6 border-t border-border/60 pt-6">
            <p className="font-display text-[16px] font-semibold tracking-[-0.02em]">Restore a backup</p>
            <p className="mt-1 max-w-[480px] text-[12px] leading-5 text-muted-foreground">
              We validate the file before saving anything, then merge it in. Existing records are updated and new ones are
              added — nothing is ever deleted.
            </p>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                aria-label="Backup file"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setSelectedFile(file);
                  setFileName(file?.name ?? '');
                  setError(file && file.size > MAX_BACKUP_BYTES ? 'That file is larger than 25 MB. Choose a smaller backup.' : null);
                  setSummary(null);
                }}
                data-testid="input-import-backup"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                className="h-11 gap-2 rounded-xl px-5"
                data-testid="button-choose-backup"
              >
                <Upload size={15} />
                {fileName ? 'Choose a different file' : 'Choose backup file'}
              </Button>
              {fileName && <span className="truncate text-[12px] text-muted-foreground" data-testid="text-import-filename">{fileName}</span>}
            </div>

            <Button
              type="button"
              onClick={runImport}
              disabled={busy || !fileName}
              className="mt-3 h-11 w-full gap-2 rounded-xl sm:w-auto sm:px-6"
              data-testid="button-import-backup"
            >
              {busy && <LoaderCircle size={15} className="animate-spin" />}
              {busy ? 'Importing…' : 'Import backup'}
            </Button>

            {error && (
              <p className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-[13px] text-destructive" data-testid="status-import-error">
                {error}
              </p>
            )}
            {summary && <ImportSummary summary={summary} />}
          </div>
        </div>
      </section>
    </div>
  );
}
