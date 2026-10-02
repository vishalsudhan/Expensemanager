import type { ExpenseInput } from '@workspace/api-client-react';
import { createExpense } from '@workspace/api-client-react';

const DB_NAME = 'pocketful-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending-expenses';

export interface PendingLabel {
  name: string;
  color: string;
}

export interface PendingExpenseDisplay {
  amount: string;
  currencyCode: string;
  currencySymbol: string;
  date: string;
  description: string | null;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string | null;
  projectName: string | null;
  labels: PendingLabel[];
}

export interface PendingExpense {
  id: string;
  input: ExpenseInput;
  display: PendingExpenseDisplay;
  createdAt: string;
  attempts: number;
  status: 'pending' | 'failed';
  error?: string;
}

export interface NewPendingExpense {
  input: ExpenseInput;
  display: PendingExpenseDisplay;
}

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
  stoppedOffline: boolean;
}

const listeners = new Set<() => void>();
let memory: PendingExpense[] = [];
let snapshot: PendingExpense[] = [];
let dbPromise: Promise<IDBDatabase> | null = null;
let hydrated = false;
let hydration: Promise<void> | null = null;
let flushing = false;

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function refreshSnapshot(): void {
  snapshot = [...memory].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  listeners.forEach((listener) => listener());
}

export function subscribeToPendingExpenses(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingExpensesSnapshot(): PendingExpense[] {
  return snapshot;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open offline store'));
    });
  }
  return dbPromise;
}

async function readAll(db: IDBDatabase): Promise<PendingExpense[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as PendingExpense[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error('Could not read offline store'));
  });
}

async function write(db: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    action(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not update offline store'));
    tx.onabort = () => reject(tx.error ?? new Error('Offline store update was aborted'));
  });
}

export async function hydrateOfflineStore(): Promise<void> {
  if (hydrated) return;
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      const db = await openDatabase();
      memory = await readAll(db);
    } catch {
      memory = [];
    } finally {
      hydrated = true;
      refreshSnapshot();
    }
  })();
  return hydration;
}

export async function enqueueExpense(entry: NewPendingExpense): Promise<PendingExpense> {
  const record: PendingExpense = {
    id: createId(),
    input: entry.input,
    display: entry.display,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
  };
  memory = [record, ...memory];
  refreshSnapshot();
  try {
    const db = await openDatabase();
    await write(db, 'readwrite', (store) => store.put(record));
  } catch {
    // In-memory fallback keeps the expense for this session.
  }
  return record;
}

export async function removePendingExpense(id: string): Promise<void> {
  memory = memory.filter((record) => record.id !== id);
  refreshSnapshot();
  try {
    const db = await openDatabase();
    await write(db, 'readwrite', (store) => store.delete(id));
  } catch {
    // Already removed from memory.
  }
}

async function updatePendingExpense(id: string, update: Partial<PendingExpense>): Promise<void> {
  const existing = memory.find((record) => record.id === id);
  if (!existing) return;
  const next = { ...existing, ...update };
  memory = memory.map((record) => (record.id === id ? next : record));
  refreshSnapshot();
  try {
    const db = await openDatabase();
    await write(db, 'readwrite', (store) => store.put(next));
  } catch {
    // Already updated in memory.
  }
}

export async function markPendingFailed(id: string, error: string): Promise<void> {
  const existing = memory.find((record) => record.id === id);
  await updatePendingExpense(id, { status: 'failed', error, attempts: (existing?.attempts ?? 0) + 1 });
}

export async function retryFailedExpenses(): Promise<void> {
  const failed = memory.filter((record) => record.status === 'failed');
  for (const record of failed) {
    await updatePendingExpense(record.id, { status: 'pending', error: undefined });
  }
}

function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (error instanceof TypeError) return true;
  if (error && typeof error === 'object') {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status >= 500;
  }
  return false;
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'error' in error) {
    const value = (error as { error?: unknown }).error;
    if (typeof value === 'string' && value.trim()) return value;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'This expense could not be synced. It is still saved on this device.';
}

export async function flushPendingExpenses(): Promise<SyncResult> {
  await hydrateOfflineStore();
  if (flushing) {
    return { synced: 0, failed: 0, remaining: snapshot.length, stoppedOffline: false };
  }
  flushing = true;
  let synced = 0;
  let failed = 0;
  let stoppedOffline = false;
  try {
    const ordered = [...memory]
      .filter((record) => record.status === 'pending')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const record of ordered) {
      try {
        await createExpense(record.input);
        await removePendingExpense(record.id);
        synced += 1;
      } catch (error) {
        if (isNetworkError(error)) {
          stoppedOffline = true;
          break;
        }
        await markPendingFailed(record.id, errorText(error));
        failed += 1;
      }
    }

    return { synced, failed, remaining: snapshot.length, stoppedOffline };
  } finally {
    flushing = false;
  }
}
