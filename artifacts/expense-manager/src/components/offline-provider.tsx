import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  flushPendingExpenses,
  getPendingExpensesSnapshot,
  hydrateOfflineStore,
  retryFailedExpenses,
  subscribeToPendingExpenses,
  type PendingExpense,
} from '@/lib/offline-store';
import { useToast } from '@/hooks/use-toast';

interface OfflineContextValue {
  online: boolean;
  syncing: boolean;
  hydrated: boolean;
  pending: PendingExpense[];
  pendingCount: number;
  failedCount: number;
  lastSyncedAt: string | null;
  syncNow: () => Promise<void>;
  retryFailed: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

const getOnlineSnapshot = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

function subscribeToOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const online = useSyncExternalStore(subscribeToOnline, getOnlineSnapshot, () => true);
  const pending = useSyncExternalStore(
    subscribeToPendingExpenses,
    getPendingExpensesSnapshot,
    getPendingExpensesSnapshot,
  );
  const [syncing, setSyncing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const retryRef = useRef<{ timer: number | null; delay: number }>({ timer: null, delay: 3000 });
  const toastRef = useRef(toast);
  const syncNowRef = useRef<() => Promise<void>>(async () => {});
  toastRef.current = toast;

  useEffect(() => {
    let active = true;
    hydrateOfflineStore().finally(() => {
      if (active) setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const clearRetry = useCallback(() => {
    if (retryRef.current.timer !== null) {
      window.clearTimeout(retryRef.current.timer);
      retryRef.current.timer = null;
    }
  }, []);

  const scheduleRetry = useCallback(() => {
    clearRetry();
    const delay = retryRef.current.delay;
    retryRef.current.delay = Math.min(delay * 2, 30000);
    retryRef.current.timer = window.setTimeout(() => {
      retryRef.current.timer = null;
      if (typeof navigator === 'undefined' || navigator.onLine) void syncNowRef.current();
    }, delay);
  }, [clearRetry]);

  const syncNow = useCallback(async () => {
    if (syncingRef.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    syncingRef.current = true;
    setSyncing(true);
    try {
      const result = await flushPendingExpenses();
      if (result.synced > 0) {
        await queryClient.invalidateQueries();
        setLastSyncedAt(new Date().toISOString());
        toastRef.current({
          title: `Synced ${result.synced} ${result.synced === 1 ? 'expense' : 'expenses'}`,
          description: 'Your saved expenses are now on the server.',
        });
      }
      if (result.failed > 0) {
        toastRef.current({
          title: result.failed === 1 ? "1 expense couldn't sync" : `${result.failed} expenses couldn't sync`,
          description: 'They are still saved on this device. Try again when you are ready.',
          variant: 'destructive',
        });
      }
      if (result.stoppedOffline && result.remaining > 0) {
        scheduleRetry();
      } else if (result.remaining === 0) {
        retryRef.current.delay = 3000;
        clearRetry();
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [queryClient, scheduleRetry, clearRetry]);
  syncNowRef.current = syncNow;

  useEffect(() => {
    if (hydrated && online) void syncNow();
  }, [hydrated, online, syncNow]);

  // Try again as soon as something new is queued (covers a failed request while
  // the browser still believes it is online).
  useEffect(() => {
    if (!hydrated || !online) return;
    if (pending.some((record) => record.status === 'pending')) void syncNow();
  }, [hydrated, online, pending, syncNow]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setInterval(() => {
      if (typeof navigator === 'undefined' || navigator.onLine) void syncNow();
    }, 30000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hydrated, syncNow]);

  useEffect(() => () => clearRetry(), [clearRetry]);

  const retryFailed = useCallback(async () => {
    await retryFailedExpenses();
    await syncNow();
  }, [syncNow]);

  const value = useMemo<OfflineContextValue>(() => {
    const failedCount = pending.filter((record) => record.status === 'failed').length;
    return {
      online,
      syncing,
      hydrated,
      pending,
      pendingCount: pending.length,
      failedCount,
      lastSyncedAt,
      syncNow,
      retryFailed,
    };
  }, [online, syncing, hydrated, pending, lastSyncedAt, syncNow, retryFailed]);

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineContextValue {
  const context = useContext(OfflineContext);
  if (!context) throw new Error('useOffline must be used within an OfflineProvider');
  return context;
}
