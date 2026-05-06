import type { HeadMeta } from "./head-meta";
import type { TextTreeNode } from "./html-text-tree";
import {
  mergeTextTreeIntoGraph,
  removeVerticesIntroducedByLedgerSeq,
  type MergedTextGraph,
} from "./merged-text-graph";

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

type PolledMetaRecord = Omit<PolledUniqueRecord, "rawHtml">;
type RawHtmlRecord = { digest: string; rawHtml: string };

export type ProcessedByUrlRecord = {
  fullUrl: string;
  graph: MergedTextGraph;
};

export type SiteMetadataRecord = {
  origin: string;
  lines: string[];
};

export type SiteRequestMetric = {
  at: string;
  pageUrl?: string;
  url: string;
  method: string;
  requestPayloadBytes?: number | null;
  requestContentType?: string;
  responseStatus?: number;
  responseBytes?: number | null;
  responseContentType?: string;
  error?: string;
};

export type SiteRequestLogRecord = {
  origin: string;
  entries: SiteRequestMetric[];
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
const DB_VERSION = 6;
const STORE_RAW_HTML = "raw_html_by_digest";
const STORE_POLLED_META = "poll_meta_by_digest";
const STORE_PROCESSED = "processed_by_url";
const STORE_LEDGER = "snapshot_ledger";
const STORE_SITE_METADATA = "site_metadata_lines";
const STORE_SITE_REQUESTS = "site_request_log";

function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length;
}

function safeJsonLen(value: unknown): number {
  return utf8Len(JSON.stringify(value));
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

type MemoryState = {
  rawHtml: Map<string, RawHtmlRecord>;
  polledMeta: Map<string, PolledMetaRecord>;
  processed: Map<string, ProcessedByUrlRecord>;
  siteMetadata: Map<string, SiteMetadataRecord>;
  siteRequests: Map<string, SiteRequestLogRecord>;
  ledger: Map<number, LedgerStored>;
  nextLedgerSeq: number;
};

const memory: MemoryState = {
  rawHtml: new Map(),
  polledMeta: new Map(),
  processed: new Map(),
  siteMetadata: new Map(),
  siteRequests: new Map(),
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

export function originFromUrl(url: string): string {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return "unknown://unknown";
  }
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
      if (oldVersion < 6) {
        for (const name of Array.from(db.objectStoreNames)) {
          db.deleteObjectStore(name);
        }
        db.createObjectStore(STORE_RAW_HTML, { keyPath: "digest" });
        db.createObjectStore(STORE_POLLED_META, { keyPath: "digest" });
        db.createObjectStore(STORE_PROCESSED, { keyPath: "fullUrl" });
        db.createObjectStore(STORE_LEDGER, { autoIncrement: true });
        db.createObjectStore(STORE_SITE_METADATA, { keyPath: "origin" });
        db.createObjectStore(STORE_SITE_REQUESTS, { keyPath: "origin" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return dbPromise;
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

async function listAllSiteMetadata(): Promise<SiteMetadataRecord[]> {
  if (!hasIndexedDb()) {
    return [...memory.siteMetadata.values()];
  }
  const db = await openDb();
  const tx = db.transaction(STORE_SITE_METADATA, "readonly");
  const rows = await reqToPromise(
    tx.objectStore(STORE_SITE_METADATA).getAll() as IDBRequest<SiteMetadataRecord[]>,
  );
  await txDone(tx);
  return rows;
}

async function listAllSiteRequests(): Promise<SiteRequestLogRecord[]> {
  if (!hasIndexedDb()) {
    return [...memory.siteRequests.values()];
  }
  const db = await openDb();
  const tx = db.transaction(STORE_SITE_REQUESTS, "readonly");
  const rows = await reqToPromise(
    tx.objectStore(STORE_SITE_REQUESTS).getAll() as IDBRequest<SiteRequestLogRecord[]>,
  );
  await txDone(tx);
  return rows;
}

/** Estimated bytes for store 1 only (raw html + poll metadata by digest). */
export async function estimateBytesStore1(): Promise<number> {
  if (!hasIndexedDb()) {
    let sum = 0;
    for (const [, raw] of memory.rawHtml) {
      sum += utf8Len(raw.digest) + utf8Len(raw.rawHtml) + 48;
    }
    for (const [, meta] of memory.polledMeta) {
      sum += safeJsonLen(meta) + 48;
    }
    return sum;
  }
  const db = await openDb();
  const tx = db.transaction([STORE_RAW_HTML, STORE_POLLED_META], "readonly");
  const rawRows = await reqToPromise(
    tx.objectStore(STORE_RAW_HTML).getAll() as IDBRequest<RawHtmlRecord[]>,
  );
  const metaRows = await reqToPromise(
    tx.objectStore(STORE_POLLED_META).getAll() as IDBRequest<PolledMetaRecord[]>,
  );
  await txDone(tx);
  let sum = 0;
  for (const row of rawRows) {
    sum += utf8Len(row.digest) + utf8Len(row.rawHtml) + 48;
  }
  for (const row of metaRows) {
    sum += safeJsonLen(row) + 48;
  }
  return sum;
}

/** Estimated bytes for stores 2 + 3 + site metadata + request logs. */
export async function estimateBytesStores23(): Promise<number> {
  const [processed, siteMetadata, siteRequests] = await Promise.all([
    listAllProcessed(),
    listAllSiteMetadata(),
    listAllSiteRequests(),
  ]);
  let sum = 0;
  for (const row of processed) {
    sum += utf8Len(row.fullUrl) + safeJsonLen(row.graph) + 32;
  }
  for (const row of siteMetadata) {
    sum += utf8Len(row.origin) + safeJsonLen(row.lines) + 32;
  }
  for (const row of siteRequests) {
    sum += utf8Len(row.origin) + safeJsonLen(row.entries) + 32;
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
    const meta = memory.polledMeta.get(digest);
    const raw = memory.rawHtml.get(digest);
    if (!meta || !raw) {
      return null;
    }
    return { ...meta, rawHtml: raw.rawHtml };
  }
  const db = await openDb();
  const tx = db.transaction([STORE_POLLED_META, STORE_RAW_HTML], "readonly");
  const meta = await reqToPromise(
    tx.objectStore(STORE_POLLED_META).get(digest) as IDBRequest<PolledMetaRecord | undefined>,
  );
  const raw = await reqToPromise(
    tx.objectStore(STORE_RAW_HTML).get(digest) as IDBRequest<RawHtmlRecord | undefined>,
  );
  await txDone(tx);
  if (!meta || !raw) {
    return null;
  }
  return { ...meta, rawHtml: raw.rawHtml };
}

/** Insert split raw + metadata rows and return whether insert happened (false if digest existed). */
export async function tryPutPolledUnique(record: PolledUniqueRecord): Promise<boolean> {
  const meta: PolledMetaRecord = {
    digest: record.digest,
    fullUrl: record.fullUrl,
    title: record.title,
    capturedAt: record.capturedAt,
    tabId: record.tabId,
    windowId: record.windowId,
    headMeta: record.headMeta,
  };
  const raw: RawHtmlRecord = { digest: record.digest, rawHtml: record.rawHtml };

  if (!hasIndexedDb()) {
    if (memory.polledMeta.has(record.digest)) {
      return false;
    }
    memory.polledMeta.set(record.digest, meta);
    memory.rawHtml.set(record.digest, raw);
    return true;
  }
  const db = await openDb();
  const tx = db.transaction([STORE_POLLED_META, STORE_RAW_HTML], "readwrite");
  const metaStore = tx.objectStore(STORE_POLLED_META);
  const existing = await reqToPromise(
    metaStore.get(record.digest) as IDBRequest<PolledMetaRecord | undefined>,
  );
  if (existing) {
    await txDone(tx);
    return false;
  }
  metaStore.put(meta);
  tx.objectStore(STORE_RAW_HTML).put(raw);
  await txDone(tx);
  return true;
}

export async function clearPolledUniqueStore(): Promise<void> {
  if (!hasIndexedDb()) {
    memory.polledMeta.clear();
    memory.rawHtml.clear();
    return;
  }
  const db = await openDb();
  const tx = db.transaction([STORE_POLLED_META, STORE_RAW_HTML], "readwrite");
  tx.objectStore(STORE_POLLED_META).clear();
  tx.objectStore(STORE_RAW_HTML).clear();
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

function estimateProcessedRowBytes(row: ProcessedByUrlRecord | null): number {
  if (!row) {
    return 0;
  }
  return utf8Len(row.fullUrl) + safeJsonLen(row.graph) + 32;
}

async function nextLedgerSeqFromStore(store: IDBObjectStore): Promise<number> {
  return new Promise((resolve, reject) => {
    const rq = store.openCursor(null, "prev");
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const cursor = rq.result as IDBCursorWithValue | null;
      if (!cursor) {
        resolve(1);
        return;
      }
      resolve((cursor.key as number) + 1);
    };
  });
}

/** Merge tree into per-URL graph and append ledger row atomically. */
export async function mergeTreeIntoGraphAndLedger(
  fullUrl: string,
  snapshotId: string,
  tree: TextTreeNode,
): Promise<void> {
  const createdAt = new Date().toISOString();

  if (!hasIndexedDb()) {
    const seq = memory.nextLedgerSeq;
    memory.nextLedgerSeq += 1;
    const before = memory.processed.get(fullUrl) ?? null;
    const merged = await mergeTextTreeIntoGraph(before?.graph, tree, seq);
    const nextRow: ProcessedByUrlRecord = { fullUrl, graph: merged.graph };
    memory.processed.set(fullUrl, nextRow);
    const beforeBytes = estimateProcessedRowBytes(before);
    const afterBytes = estimateProcessedRowBytes(nextRow);
    const bytesEstimate = Math.max(64, afterBytes - beforeBytes);
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
  const seq = await nextLedgerSeqFromStore(lStore);
  const merged = await mergeTextTreeIntoGraph(prev?.graph, tree, seq);
  const nextRow: ProcessedByUrlRecord = { fullUrl, graph: merged.graph };
  pStore.put(nextRow);

  const beforeBytes = estimateProcessedRowBytes(prev ?? null);
  const afterBytes = estimateProcessedRowBytes(nextRow);
  const bytesEstimate = Math.max(64, afterBytes - beforeBytes);
  lStore.put({ snapshotId, fullUrl, createdAt, bytesEstimate }, seq);

  await txDone(tx);
}

export async function mergeSiteMetadataLines(origin: string, lines: string[]): Promise<void> {
  if (lines.length === 0) {
    return;
  }
  const dedup = new Set(lines.map((line) => line.trim()).filter((line) => line.length > 0));
  if (dedup.size === 0) {
    return;
  }
  if (!hasIndexedDb()) {
    const existing = memory.siteMetadata.get(origin);
    const merged = new Set(existing?.lines ?? []);
    for (const line of dedup) {
      merged.add(line);
    }
    memory.siteMetadata.set(origin, { origin, lines: [...merged].sort() });
    return;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_SITE_METADATA, "readwrite");
  const store = tx.objectStore(STORE_SITE_METADATA);
  const existing = await reqToPromise(
    store.get(origin) as IDBRequest<SiteMetadataRecord | undefined>,
  );
  const merged = new Set(existing?.lines ?? []);
  for (const line of dedup) {
    merged.add(line);
  }
  store.put({ origin, lines: [...merged].sort() });
  await txDone(tx);
}

export async function appendSiteRequestLog(
  origin: string,
  entry: SiteRequestMetric,
  maxEntriesPerOrigin = 2000,
): Promise<void> {
  if (!hasIndexedDb()) {
    const current = [...(memory.siteRequests.get(origin)?.entries ?? []), entry];
    while (current.length > maxEntriesPerOrigin) {
      current.shift();
    }
    memory.siteRequests.set(origin, { origin, entries: current });
    return;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_SITE_REQUESTS, "readwrite");
  const store = tx.objectStore(STORE_SITE_REQUESTS);
  const prev = await reqToPromise(
    store.get(origin) as IDBRequest<SiteRequestLogRecord | undefined>,
  );
  const entries = [...(prev?.entries ?? []), entry];
  while (entries.length > maxEntriesPerOrigin) {
    entries.shift();
  }
  store.put({ origin, entries });
  await txDone(tx);
}

export async function trimStores23ToTargetBytes(targetBytes: number): Promise<number> {
  let removed = 0;
  let total = await estimateBytesStores23();
  while (total > targetBytes) {
    const next = await deleteOldestLedgerAndGraphContribution();
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

async function deleteOldestLedgerAndGraphContribution(): Promise<boolean> {
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
      const pruned = removeVerticesIntroducedByLedgerSeq(proc.graph, seq).graph;
      if (Object.keys(pruned.vertices).length === 0) {
        memory.processed.delete(row.fullUrl);
      } else {
        memory.processed.set(row.fullUrl, { fullUrl: row.fullUrl, graph: pruned });
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
    const pruned = removeVerticesIntroducedByLedgerSeq(proc.graph, seq).graph;
    if (Object.keys(pruned.vertices).length === 0) {
      pStore.delete(ledgerRow.fullUrl);
    } else {
      pStore.put({ fullUrl: ledgerRow.fullUrl, graph: pruned });
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

/** Delete all stores + reset memory ledger seq. */
export async function clearAllStores(): Promise<void> {
  if (!hasIndexedDb()) {
    memory.rawHtml.clear();
    memory.polledMeta.clear();
    memory.processed.clear();
    memory.siteMetadata.clear();
    memory.siteRequests.clear();
    memory.ledger.clear();
    memory.nextLedgerSeq = 1;
    return;
  }
  const db = await openDb();
  const tx = db.transaction(
    [
      STORE_RAW_HTML,
      STORE_POLLED_META,
      STORE_PROCESSED,
      STORE_LEDGER,
      STORE_SITE_METADATA,
      STORE_SITE_REQUESTS,
    ],
    "readwrite",
  );
  tx.objectStore(STORE_RAW_HTML).clear();
  tx.objectStore(STORE_POLLED_META).clear();
  tx.objectStore(STORE_PROCESSED).clear();
  tx.objectStore(STORE_LEDGER).clear();
  tx.objectStore(STORE_SITE_METADATA).clear();
  tx.objectStore(STORE_SITE_REQUESTS).clear();
  await txDone(tx);
}

/** Enumerate processed rows for export (all URLs). */
export async function listProcessedForExport(): Promise<ProcessedByUrlRecord[]> {
  return listAllProcessed();
}

export async function countLedgerRows(): Promise<number> {
  if (!hasIndexedDb()) {
    return memory.ledger.size;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_LEDGER, "readonly");
  const count = await reqToPromise(tx.objectStore(STORE_LEDGER).count());
  await txDone(tx);
  return count;
}

export async function listSiteMetadataForExport(): Promise<SiteMetadataRecord[]> {
  const rows = await listAllSiteMetadata();
  return rows.sort((a, b) => a.origin.localeCompare(b.origin));
}

export async function listSiteRequestsForExport(): Promise<SiteRequestLogRecord[]> {
  const rows = await listAllSiteRequests();
  return rows.sort((a, b) => a.origin.localeCompare(b.origin));
}

/** Test helpers — snapshot of in-memory IDB when IndexedDB is unavailable */
export function memoryStoresSnapshot(): {
  polled: PolledUniqueRecord[];
  processed: ProcessedByUrlRecord[];
  siteMetadata: SiteMetadataRecord[];
  siteRequests: SiteRequestLogRecord[];
  ledger: Array<{ seq: number } & LedgerStored>;
} {
  const polled: PolledUniqueRecord[] = [];
  for (const [digest, meta] of memory.polledMeta.entries()) {
    const raw = memory.rawHtml.get(digest);
    if (!raw) {
      continue;
    }
    polled.push({ ...meta, rawHtml: raw.rawHtml });
  }
  return {
    polled,
    processed: [...memory.processed.values()],
    siteMetadata: [...memory.siteMetadata.values()],
    siteRequests: [...memory.siteRequests.values()],
    ledger: [...memory.ledger.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seq, row]) => ({ seq, ...row })),
  };
}

export function resetMemoryStores(): void {
  memory.rawHtml.clear();
  memory.polledMeta.clear();
  memory.processed.clear();
  memory.siteMetadata.clear();
  memory.siteRequests.clear();
  memory.ledger.clear();
  memory.nextLedgerSeq = 1;
}
