export type RawPageRecord = {
  id: string;
  createdAt: string;
  tabId: number;
  windowId: number;
  url: string;
  urlPrefix: string;
  title: string;
  reason: string;
  textContent: string;
  htmlContent?: string;
  signatureHash: number;
  contentSizeBytes: number;
};

export type QueueStatus = "pending" | "processing" | "failed";

export type QueueRecord = {
  id: string;
  rawId: string;
  createdAt: string;
  tabId: number;
  urlPrefix: string;
  dedupeKey: string;
  status: QueueStatus;
  attempts: number;
  error?: string;
  lastUpdatedAt: string;
};

export type EnrichedPageRecord = {
  id: string;
  createdAt: string;
  tabId: number;
  windowId: number;
  url: string;
  urlPrefix: string;
  title: string;
  reason: string;
  timestamp: string;
  textContent?: string;
  htmlContent?: string;
  signatureHash: number;
  sectionCount: number;
  contentSizeBytes: number;
};

export type PipelineStats = {
  queue: {
    pending: number;
    processing: number;
    failed: number;
    processed: number;
  };
  totals: {
    rawCount: number;
    enrichedCount: number;
    totalBytes: number;
    estimatedCompressedBytes: number;
  };
  urlRows: Array<{
    url: string;
    pageCount: number;
    bytes: number;
  }>;
  generatedAt: string;
};

type MemoryDbState = {
  rawPages: Map<string, RawPageRecord>;
  queue: Map<string, QueueRecord>;
  enrichedPages: Map<string, EnrichedPageRecord>;
  processedCount: number;
};

const DB_NAME = "recorder-idb";
const DB_VERSION = 2;
const STORE_RAW = "raw_pages";
const STORE_QUEUE = "page_queue";
const STORE_ENRICHED = "enriched_pages";
const INDEX_QUEUE_STATUS = "status";
const INDEX_QUEUE_DEDUPE_KEY = "dedupeKey";
const INDEX_ENRICHED_URL_HASH = "urlHash";
const METRIC_KEY = "__metrics";

let dbPromise: Promise<IDBDatabase> | null = null;

const memoryState: MemoryDbState = {
  rawPages: new Map<string, RawPageRecord>(),
  queue: new Map<string, QueueRecord>(),
  enrichedPages: new Map<string, EnrichedPageRecord>(),
  processedCount: 0,
};

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_RAW)) {
        db.createObjectStore(STORE_RAW, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const queueStore = db.createObjectStore(STORE_QUEUE, { keyPath: "id" });
        queueStore.createIndex(INDEX_QUEUE_STATUS, "status", { unique: false });
        queueStore.createIndex(INDEX_QUEUE_DEDUPE_KEY, "dedupeKey", { unique: false });
      } else {
        const queueStore = request.transaction!.objectStore(STORE_QUEUE);
        if (!queueStore.indexNames.contains(INDEX_QUEUE_STATUS)) {
          queueStore.createIndex(INDEX_QUEUE_STATUS, "status", { unique: false });
        }
        if (!queueStore.indexNames.contains(INDEX_QUEUE_DEDUPE_KEY)) {
          queueStore.createIndex(INDEX_QUEUE_DEDUPE_KEY, "dedupeKey", { unique: false });
        }
      }
      if (!db.objectStoreNames.contains(STORE_ENRICHED)) {
        const enrichedStore = db.createObjectStore(STORE_ENRICHED, { keyPath: "id" });
        enrichedStore.createIndex(INDEX_ENRICHED_URL_HASH, ["url", "signatureHash"], {
          unique: false,
        });
      } else {
        const enrichedStore = request.transaction!.objectStore(STORE_ENRICHED);
        if (!enrichedStore.indexNames.contains(INDEX_ENRICHED_URL_HASH)) {
          enrichedStore.createIndex(INDEX_ENRICHED_URL_HASH, ["url", "signatureHash"], {
            unique: false,
          });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return dbPromise;
}

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

async function listAllFromStore<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const values = await reqToPromise(store.getAll() as IDBRequest<T[]>);
  await txDone(tx);
  return values;
}

async function getProcessedCount(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE_ENRICHED, "readonly");
  const store = tx.objectStore(STORE_ENRICHED);
  const value = await reqToPromise(
    store.get(METRIC_KEY) as IDBRequest<{ value?: number } | undefined>,
  );
  await txDone(tx);
  return value?.value ?? 0;
}

async function setProcessedCount(nextValue: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_ENRICHED, "readwrite");
  const store = tx.objectStore(STORE_ENRICHED);
  store.put({ id: METRIC_KEY, value: Math.max(0, nextValue) });
  await txDone(tx);
}

export async function addRawAndQueue(
  raw: RawPageRecord,
  queue: QueueRecord,
): Promise<{ accepted: boolean }> {
  if (!hasIndexedDb()) {
    memoryState.rawPages.set(raw.id, raw);
    memoryState.queue.set(queue.id, queue);
    return { accepted: true };
  }

  const db = await openDb();
  const tx = db.transaction([STORE_RAW, STORE_QUEUE], "readwrite");
  const queueStore = tx.objectStore(STORE_QUEUE);
  tx.objectStore(STORE_RAW).put(raw);
  queueStore.put(queue);
  await txDone(tx);
  return { accepted: true };
}

export async function pollNextQueueRecord(): Promise<QueueRecord | null> {
  const now = new Date().toISOString();
  if (!hasIndexedDb()) {
    const pending = [...memoryState.queue.values()]
      .filter((record) => record.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const next = pending[0];
    if (!next) {
      return null;
    }
    next.status = "processing";
    next.lastUpdatedAt = now;
    next.attempts += 1;
    memoryState.queue.set(next.id, next);
    return next;
  }

  const db = await openDb();
  const tx = db.transaction(STORE_QUEUE, "readwrite");
  const queueStore = tx.objectStore(STORE_QUEUE);
  const statusIndex = queueStore.index(INDEX_QUEUE_STATUS);
  const pending = (await reqToPromise(
    statusIndex.getAll("pending") as IDBRequest<QueueRecord[]>,
  )) as QueueRecord[];
  pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const next = pending[0];
  if (!next) {
    await txDone(tx);
    return null;
  }
  const processing: QueueRecord = {
    ...next,
    status: "processing",
    attempts: next.attempts + 1,
    lastUpdatedAt: now,
  };
  queueStore.put(processing);
  await txDone(tx);
  return processing;
}

export async function getRawPage(rawId: string): Promise<RawPageRecord | null> {
  if (!hasIndexedDb()) {
    return memoryState.rawPages.get(rawId) ?? null;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_RAW, "readonly");
  const store = tx.objectStore(STORE_RAW);
  const record = await reqToPromise(store.get(rawId) as IDBRequest<RawPageRecord | undefined>);
  await txDone(tx);
  return record ?? null;
}

export async function hasEnrichedSignature(url: string, signatureHash: number): Promise<boolean> {
  if (!hasIndexedDb()) {
    return [...memoryState.enrichedPages.values()].some(
      (row) => row.url === url && row.signatureHash === signatureHash,
    );
  }
  const db = await openDb();
  const tx = db.transaction(STORE_ENRICHED, "readonly");
  const store = tx.objectStore(STORE_ENRICHED);
  const index = store.index(INDEX_ENRICHED_URL_HASH);
  const existing = await reqToPromise(
    index.get([url, signatureHash]) as IDBRequest<EnrichedPageRecord | undefined>,
  );
  await txDone(tx);
  return Boolean(existing);
}

export async function acknowledgeProcessed(
  queueId: string,
  rawId: string,
  enriched: EnrichedPageRecord,
): Promise<void> {
  if (!hasIndexedDb()) {
    memoryState.enrichedPages.set(enriched.id, enriched);
    memoryState.queue.delete(queueId);
    memoryState.rawPages.delete(rawId);
    memoryState.processedCount += 1;
    return;
  }
  const db = await openDb();
  const tx = db.transaction([STORE_QUEUE, STORE_RAW, STORE_ENRICHED], "readwrite");
  tx.objectStore(STORE_ENRICHED).put(enriched);
  tx.objectStore(STORE_QUEUE).delete(queueId);
  tx.objectStore(STORE_RAW).delete(rawId);
  await txDone(tx);
  const count = await getProcessedCount();
  await setProcessedCount(count + 1);
}

export async function acknowledgeDiscarded(queueId: string, rawId: string): Promise<void> {
  if (!hasIndexedDb()) {
    memoryState.queue.delete(queueId);
    memoryState.rawPages.delete(rawId);
    memoryState.processedCount += 1;
    return;
  }
  const db = await openDb();
  const tx = db.transaction([STORE_QUEUE, STORE_RAW], "readwrite");
  tx.objectStore(STORE_QUEUE).delete(queueId);
  tx.objectStore(STORE_RAW).delete(rawId);
  await txDone(tx);
  const count = await getProcessedCount();
  await setProcessedCount(count + 1);
}

export async function markQueueFailed(queueId: string, error: string): Promise<void> {
  const now = new Date().toISOString();
  if (!hasIndexedDb()) {
    const current = memoryState.queue.get(queueId);
    if (!current) {
      return;
    }
    memoryState.queue.set(queueId, {
      ...current,
      status: "failed",
      error,
      lastUpdatedAt: now,
    });
    return;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_QUEUE, "readwrite");
  const store = tx.objectStore(STORE_QUEUE);
  const current = await reqToPromise(store.get(queueId) as IDBRequest<QueueRecord | undefined>);
  if (current) {
    store.put({
      ...current,
      status: "failed",
      error,
      lastUpdatedAt: now,
    });
  }
  await txDone(tx);
}

export async function hasPendingQueueMessages(): Promise<boolean> {
  if (!hasIndexedDb()) {
    return [...memoryState.queue.values()].some((record) => record.status === "pending");
  }
  const db = await openDb();
  const tx = db.transaction(STORE_QUEUE, "readonly");
  const statusIndex = tx.objectStore(STORE_QUEUE).index(INDEX_QUEUE_STATUS);
  const pending = (await reqToPromise(
    statusIndex.getAll("pending") as IDBRequest<QueueRecord[]>,
  )) as QueueRecord[];
  await txDone(tx);
  return pending.length > 0;
}

export async function listEnrichedPages(): Promise<EnrichedPageRecord[]> {
  if (!hasIndexedDb()) {
    return [...memoryState.enrichedPages.values()].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
  }
  const values = await listAllFromStore<EnrichedPageRecord | { id: string; value?: number }>(
    STORE_ENRICHED,
  );
  return values
    .filter(
      (entry): entry is EnrichedPageRecord =>
        typeof (entry as EnrichedPageRecord).timestamp === "string" &&
        (entry as EnrichedPageRecord).id !== METRIC_KEY,
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function clearAllCaptureData(): Promise<void> {
  if (!hasIndexedDb()) {
    memoryState.rawPages.clear();
    memoryState.queue.clear();
    memoryState.enrichedPages.clear();
    memoryState.processedCount = 0;
    return;
  }
  const db = await openDb();
  const tx = db.transaction([STORE_RAW, STORE_QUEUE, STORE_ENRICHED], "readwrite");
  tx.objectStore(STORE_RAW).clear();
  tx.objectStore(STORE_QUEUE).clear();
  tx.objectStore(STORE_ENRICHED).clear();
  await txDone(tx);
}

export async function readPipelineStats(
  estimateCompressedBytes: (rawBytes: number) => number,
): Promise<PipelineStats> {
  let rawRows: RawPageRecord[];
  let queueRows: QueueRecord[];
  let enrichedRows: EnrichedPageRecord[];
  let processedCount: number;

  if (!hasIndexedDb()) {
    rawRows = [...memoryState.rawPages.values()];
    queueRows = [...memoryState.queue.values()];
    enrichedRows = [...memoryState.enrichedPages.values()];
    processedCount = memoryState.processedCount;
  } else {
    rawRows = await listAllFromStore<RawPageRecord>(STORE_RAW);
    queueRows = await listAllFromStore<QueueRecord>(STORE_QUEUE);
    enrichedRows = await listEnrichedPages();
    processedCount = await getProcessedCount();
  }

  const queuePending = queueRows.filter((row) => row.status === "pending").length;
  const queueProcessing = queueRows.filter((row) => row.status === "processing").length;
  const queueFailed = queueRows.filter((row) => row.status === "failed").length;

  const byUrl = new Map<string, { pageCount: number; bytes: number }>();
  for (const row of enrichedRows) {
    const key = row.url || "unknown";
    const current = byUrl.get(key) ?? { pageCount: 0, bytes: 0 };
    current.pageCount += 1;
    current.bytes += row.contentSizeBytes;
    byUrl.set(key, current);
  }

  const rawBytes = rawRows.reduce((sum, row) => sum + row.contentSizeBytes, 0);
  const enrichedBytes = enrichedRows.reduce((sum, row) => sum + row.contentSizeBytes, 0);
  const totalBytes = rawBytes + enrichedBytes;

  return {
    queue: {
      pending: queuePending,
      processing: queueProcessing,
      failed: queueFailed,
      processed: processedCount,
    },
    totals: {
      rawCount: rawRows.length,
      enrichedCount: enrichedRows.length,
      totalBytes,
      estimatedCompressedBytes: estimateCompressedBytes(totalBytes),
    },
    urlRows: [...byUrl.entries()]
      .map(([url, values]) => ({
        url,
        pageCount: values.pageCount,
        bytes: values.bytes,
      }))
      .sort((a, b) => b.pageCount - a.pageCount || a.url.localeCompare(b.url)),
    generatedAt: new Date().toISOString(),
  };
}
