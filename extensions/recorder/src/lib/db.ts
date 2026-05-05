import type { HeadMeta } from "./head-meta";

export type PolledUniqueRecord = {
  digest: string;
  rawHtml: string;
  fullUrl: string;
  title: string;
  capturedAt: string;
  tabId: number;
  windowId: number;
  headMeta?: HeadMeta;
};

export type SnapshotEntry = {
  id: string;
  text: string;
};

export type ProcessedByUrlRecord = {
  fullUrl: string;
  snapshots: SnapshotEntry[];
};

export type LedgerStored = {
  snapshotId: string;
  fullUrl: string;
  createdAt: string;
  bytesEstimate: number;
};

export type TrimPlan = {
  snapshotsToRemove: number;
  estimatedBytesFreed: number;
  projectedBytesAfter: number;
};

const DB_NAME = "recorder-idb";
const DB_VERSION = 3;
const STORE_POLLED = "polled_unique";
const STORE_PROCESSED = "processed_by_url";
const STORE_LEDGER = "snapshot_ledger";

function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

type MemoryState = {
  polled: Map<string, PolledUniqueRecord>;
  processed: Map<string, ProcessedByUrlRecord>;
  /** seq -> ledger row */
  ledger: Map<number, LedgerStored>;
  nextLedgerSeq: number;
};

const memory: MemoryState = {
  polled: new Map(),
  processed: new Map(),
  ledger: new Map(),
  nextLedgerSeq: 1,
};

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) {
    return Promise.reject(new Error("indexedDB unavailable"));
  }
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 3) {
        for (const name of Array.from(db.objectStoreNames)) {
          db.deleteObjectStore(name);
        }
        db.createObjectStore(STORE_POLLED, { keyPath: "digest" });
        db.createObjectStore(STORE_PROCESSED, { keyPath: "fullUrl" });
        db.createObjectStore(STORE_LEDGER, { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return dbPromise;
}

async function listAllPolled(): Promise<PolledUniqueRecord[]> {
  if (!hasIndexedDb()) {
    return [...memory.polled.values()];
  }
  const db = await openDb();
  const tx = db.transaction(STORE_POLLED, "readonly");
  const rows = await reqToPromise(
    tx.objectStore(STORE_POLLED).getAll() as IDBRequest<PolledUniqueRecord[]>,
  );
  await txDone(tx);
  return rows;
}

async function listAllProcessed(): Promise<ProcessedByUrlRecord[]> {
  if (!hasIndexedDb()) {
    return [...memory.processed.values()];
  }
  const db = await openDb();
  const tx = db.transaction(STORE_PROCESSED, "readonly");
  const rows = await reqToPromise(
    tx.objectStore(STORE_PROCESSED).getAll() as IDBRequest<ProcessedByUrlRecord[]>,
  );
  await txDone(tx);
  return rows;
}

/** Estimated bytes for store 1 only. */
export async function estimateBytesStore1(): Promise<number> {
  const rows = await listAllPolled();
  let sum = 0;
  for (const row of rows) {
    sum +=
      utf8Len(row.digest) +
      utf8Len(row.rawHtml) +
      utf8Len(row.fullUrl) +
      utf8Len(row.title) +
      utf8Len(row.capturedAt) +
      96;
  }
  return sum;
}

/** Estimated bytes for stores 2 + 3 (processed snapshots + ledger rows). */
export async function estimateBytesStores23(): Promise<number> {
  const processed = await listAllProcessed();
  let sum = 0;
  for (const row of processed) {
    sum += utf8Len(row.fullUrl);
    for (const s of row.snapshots) {
      sum += utf8Len(s.id) + utf8Len(s.text) + 32;
    }
  }
  if (!hasIndexedDb()) {
    for (const [, ledgerRow] of memory.ledger) {
      sum +=
        utf8Len(ledgerRow.snapshotId) +
        utf8Len(ledgerRow.fullUrl) +
        utf8Len(ledgerRow.createdAt) +
        ledgerRow.bytesEstimate +
        48;
    }
    return sum;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_LEDGER, "readonly");
  const store = tx.objectStore(STORE_LEDGER);
  sum += await sumLedgerCursor(store);
  await txDone(tx);
  return sum;
}

async function sumLedgerCursor(store: IDBObjectStore): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let sum = 0;
    const rq = store.openCursor();
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const cursor = rq.result as IDBCursorWithValue | null;
      if (!cursor) {
        resolve(sum);
        return;
      }
      const v = cursor.value as LedgerStored;
      sum +=
        utf8Len(v.snapshotId) + utf8Len(v.fullUrl) + utf8Len(v.createdAt) + v.bytesEstimate + 48;
      cursor.continue();
    };
  });
}

async function listLedgerRowsOrdered(): Promise<LedgerStored[]> {
  if (!hasIndexedDb()) {
    return [...memory.ledger.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
  }
  const db = await openDb();
  const tx = db.transaction(STORE_LEDGER, "readonly");
  const store = tx.objectStore(STORE_LEDGER);
  const rows = await new Promise<LedgerStored[]>((resolve, reject) => {
    const result: LedgerStored[] = [];
    const rq = store.openCursor();
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const cursor = rq.result as IDBCursorWithValue | null;
      if (!cursor) {
        resolve(result);
        return;
      }
      result.push(cursor.value as LedgerStored);
      cursor.continue();
    };
  });
  await txDone(tx);
  return rows;
}

export async function estimateBytesTotal123(): Promise<number> {
  const [a, b] = await Promise.all([estimateBytesStore1(), estimateBytesStores23()]);
  return a + b;
}

export async function getPolledUnique(digest: string): Promise<PolledUniqueRecord | null> {
  if (!hasIndexedDb()) {
    return memory.polled.get(digest) ?? null;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_POLLED, "readonly");
  const row = await reqToPromise(
    tx.objectStore(STORE_POLLED).get(digest) as IDBRequest<PolledUniqueRecord | undefined>,
  );
  await txDone(tx);
  return row ?? null;
}

/** Insert raw poll row and return whether insert happened (false if digest existed). */
export async function tryPutPolledUnique(record: PolledUniqueRecord): Promise<boolean> {
  if (!hasIndexedDb()) {
    if (memory.polled.has(record.digest)) {
      return false;
    }
    memory.polled.set(record.digest, record);
    return true;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_POLLED, "readwrite");
  const store = tx.objectStore(STORE_POLLED);
  const existing = await reqToPromise(
    store.get(record.digest) as IDBRequest<PolledUniqueRecord | undefined>,
  );
  if (existing) {
    await txDone(tx);
    return false;
  }
  store.put(record);
  await txDone(tx);
  return true;
}

export async function clearPolledUniqueStore(): Promise<void> {
  if (!hasIndexedDb()) {
    memory.polled.clear();
    return;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_POLLED, "readwrite");
  tx.objectStore(STORE_POLLED).clear();
  await txDone(tx);
}

export async function getProcessedByUrl(fullUrl: string): Promise<ProcessedByUrlRecord | null> {
  if (!hasIndexedDb()) {
    return memory.processed.get(fullUrl) ?? null;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_PROCESSED, "readonly");
  const row = await reqToPromise(
    tx.objectStore(STORE_PROCESSED).get(fullUrl) as IDBRequest<ProcessedByUrlRecord | undefined>,
  );
  await txDone(tx);
  return row ?? null;
}

/** Append snapshot text + ledger row atomically. */
export async function appendSnapshotAndLedger(
  fullUrl: string,
  snapshotId: string,
  text: string,
): Promise<void> {
  const createdAt = new Date().toISOString();
  const bytesEstimate = utf8Len(text) + 64;

  if (!hasIndexedDb()) {
    const existing = memory.processed.get(fullUrl);
    const snapshots = [...(existing?.snapshots ?? []), { id: snapshotId, text }];
    memory.processed.set(fullUrl, { fullUrl, snapshots });
    const seq = memory.nextLedgerSeq;
    memory.nextLedgerSeq += 1;
    memory.ledger.set(seq, { snapshotId, fullUrl, createdAt, bytesEstimate });
    return;
  }

  const db = await openDb();
  const tx = db.transaction([STORE_PROCESSED, STORE_LEDGER], "readwrite");
  const pStore = tx.objectStore(STORE_PROCESSED);
  const lStore = tx.objectStore(STORE_LEDGER);

  const prev = await reqToPromise(
    pStore.get(fullUrl) as IDBRequest<ProcessedByUrlRecord | undefined>,
  );
  const snapshots = [...(prev?.snapshots ?? []), { id: snapshotId, text }];
  pStore.put({ fullUrl, snapshots });
  lStore.put({ snapshotId, fullUrl, createdAt, bytesEstimate });

  await txDone(tx);
}

export async function trimStores23ToTargetBytes(targetBytes: number): Promise<number> {
  let removed = 0;
  let total = await estimateBytesStores23();
  while (total > targetBytes) {
    const next = await deleteOldestLedgerAndSnapshot();
    if (!next) {
      break;
    }
    removed += 1;
    total = await estimateBytesStores23();
  }
  return removed;
}

export async function estimateTrimPlanToTargetBytes(targetBytes: number): Promise<TrimPlan> {
  const current = await estimateBytesStores23();
  if (current <= targetBytes) {
    return { snapshotsToRemove: 0, estimatedBytesFreed: 0, projectedBytesAfter: current };
  }
  const rows = await listLedgerRowsOrdered();
  let snapshotsToRemove = 0;
  let estimatedBytesFreed = 0;
  let projectedBytesAfter = current;
  for (const row of rows) {
    if (projectedBytesAfter <= targetBytes) {
      break;
    }
    const rowBytes =
      utf8Len(row.snapshotId) +
      utf8Len(row.fullUrl) +
      utf8Len(row.createdAt) +
      row.bytesEstimate +
      48;
    snapshotsToRemove += 1;
    estimatedBytesFreed += rowBytes;
    projectedBytesAfter = Math.max(0, current - estimatedBytesFreed);
  }
  return { snapshotsToRemove, estimatedBytesFreed, projectedBytesAfter };
}

async function deleteOldestLedgerAndSnapshot(): Promise<boolean> {
  if (!hasIndexedDb()) {
    const keys = [...memory.ledger.keys()].sort((a, b) => a - b);
    const seq = keys[0];
    if (seq === undefined) {
      return false;
    }
    const row = memory.ledger.get(seq);
    memory.ledger.delete(seq);
    if (!row) {
      return true;
    }
    const proc = memory.processed.get(row.fullUrl);
    if (proc) {
      const snapshots = proc.snapshots.filter((s) => s.id !== row.snapshotId);
      if (snapshots.length === 0) {
        memory.processed.delete(row.fullUrl);
      } else {
        memory.processed.set(row.fullUrl, { fullUrl: row.fullUrl, snapshots });
      }
    }
    return true;
  }

  const db = await openDb();
  const tx = db.transaction([STORE_LEDGER, STORE_PROCESSED], "readwrite");
  const lStore = tx.objectStore(STORE_LEDGER);
  const entry = await firstLedgerCursorEntry(lStore);
  if (!entry) {
    await txDone(tx);
    return false;
  }
  const { seq, ledgerRow } = entry;
  const pStore = tx.objectStore(STORE_PROCESSED);
  const proc = await reqToPromise(
    pStore.get(ledgerRow.fullUrl) as IDBRequest<ProcessedByUrlRecord | undefined>,
  );
  if (proc) {
    const snapshots = proc.snapshots.filter((s) => s.id !== ledgerRow.snapshotId);
    if (snapshots.length === 0) {
      pStore.delete(ledgerRow.fullUrl);
    } else {
      pStore.put({ fullUrl: ledgerRow.fullUrl, snapshots });
    }
  }
  lStore.delete(seq);
  await txDone(tx);
  return true;
}

function firstLedgerCursorEntry(
  store: IDBObjectStore,
): Promise<{ seq: number; ledgerRow: LedgerStored } | null> {
  return new Promise((resolve, reject) => {
    const rq = store.openCursor();
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const cursor = rq.result as IDBCursorWithValue | null;
      if (!cursor) {
        resolve(null);
        return;
      }
      resolve({ seq: cursor.key as number, ledgerRow: cursor.value as LedgerStored });
    };
  });
}

/** Delete all three stores + reset memory ledger seq. */
export async function clearAllStores(): Promise<void> {
  if (!hasIndexedDb()) {
    memory.polled.clear();
    memory.processed.clear();
    memory.ledger.clear();
    memory.nextLedgerSeq = 1;
    return;
  }
  const db = await openDb();
  const tx = db.transaction([STORE_POLLED, STORE_PROCESSED, STORE_LEDGER], "readwrite");
  tx.objectStore(STORE_POLLED).clear();
  tx.objectStore(STORE_PROCESSED).clear();
  tx.objectStore(STORE_LEDGER).clear();
  await txDone(tx);
}

/** Enumerate processed rows for export (all URLs). */
export async function listProcessedForExport(): Promise<ProcessedByUrlRecord[]> {
  return listAllProcessed();
}

/** Test helpers — snapshot of in-memory IDB when IndexedDB is unavailable */
export function memoryStoresSnapshot(): {
  polled: PolledUniqueRecord[];
  processed: ProcessedByUrlRecord[];
  ledger: Array<{ seq: number } & LedgerStored>;
} {
  return {
    polled: [...memory.polled.values()],
    processed: [...memory.processed.values()],
    ledger: [...memory.ledger.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seq, row]) => ({ seq, ...row })),
  };
}

export function resetMemoryStores(): void {
  memory.polled.clear();
  memory.processed.clear();
  memory.ledger.clear();
  memory.nextLedgerSeq = 1;
}
