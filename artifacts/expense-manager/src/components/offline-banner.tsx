import { CloudOff, RefreshCw, TriangleAlert, Wifi } from 'lucide-react';
import { useOffline } from '@/components/offline-provider';

export function OfflineBanner() {
  const { online, syncing, pendingCount, failedCount, syncNow, retryFailed } = useOffline();

  const show = !online || syncing || pendingCount > 0;
  if (!show) return null;

  const state = !online ? 'offline' : syncing ? 'syncing' : failedCount > 0 ? 'failed' : 'pending';

  const tone =
    state === 'offline'
      ? 'border-[#b9795e]/40 bg-[#2a2320] text-[#f3e6df]'
      : state === 'failed'
        ? 'border-destructive/40 bg-destructive/12 text-foreground'
        : 'border-primary/30 bg-secondary text-secondary-foreground';

  return (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-[calc(82px+env(safe-area-inset-bottom))] z-40 flex justify-center lg:bottom-5 lg:left-[calc(252px+1.25rem)] lg:right-5"
      aria-live="polite"
      role="status"
    >
      <div
        className={`pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-2xl border px-4 py-3 text-[13px] shadow-[0_18px_50px_-28px_rgba(0,0,0,.65)] backdrop-blur-md ${tone}`}
        data-testid="status-connectivity-banner"
        data-state={state}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-black/10">
          {state === 'offline' ? (
            <CloudOff size={16} />
          ) : state === 'syncing' ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : state === 'failed' ? (
            <TriangleAlert size={16} className="text-destructive" />
          ) : (
            <Wifi size={16} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-semibold" data-testid="text-connectivity-title">
            {state === 'offline'
              ? "You're offline"
              : state === 'syncing'
                ? 'Syncing your expenses'
                : state === 'failed'
                  ? "Some expenses couldn't sync"
                  : 'Saved on this device'}
          </p>
          <p className="mt-0.5 text-[12px] leading-4 opacity-80" data-testid="text-connectivity-message">
            {state === 'offline'
              ? pendingCount > 0
                ? `${pendingCount} ${pendingCount === 1 ? 'expense is' : 'expenses are'} saved here and will sync automatically.`
                : 'New expenses are saved on this device and sync when you reconnect.'
              : state === 'syncing'
                ? `Sending ${pendingCount} saved ${pendingCount === 1 ? 'expense' : 'expenses'}…`
                : state === 'failed'
                  ? `${failedCount} ${failedCount === 1 ? 'expense' : 'expenses'} stayed saved here. Try again when you are online.`
                  : `${pendingCount} waiting to sync.`}
          </p>
        </div>

        {state === 'failed' ? (
          <button
            type="button"
            onClick={() => void retryFailed()}
            className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-border/60 bg-card/60 px-3.5 text-[12px] font-bold"
            data-testid="button-retry-sync"
          >
            Try again
          </button>
        ) : state === 'pending' ? (
          <button
            type="button"
            onClick={() => void syncNow()}
            className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-border/60 bg-card/60 px-3.5 text-[12px] font-bold"
            data-testid="button-sync-now"
          >
            Sync now
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default OfflineBanner;
