import { redactUrl, truncateText } from "./lib/redact";
import {
  acknowledgeProcessed,
  addRawAndQueue,
  clearAllCaptureData,
  getRawPage,
  hasPendingQueueMessages,
  listEnrichedPages,
  markQueueFailed,
  pollNextQueueRecord,
  readPipelineStats,
  type EnrichedPageRecord,
  type QueueRecord,
  type RawPageRecord,
} from "./lib/db";
import { estimateCompressedBytes } from "./lib/metrics";
import { parseSections } from "./lib/section-parsers/registry";
import { createZip } from "./lib/zip";
import {
  STORAGE_KEYS,
  type CapturePreset,
  type ExportMessage,
  type HostQueueStats,
  type HostQueueStatsRow,
  type PipelineStats,
  type RecorderState,
  type RecorderSettings,
  type SessionStats,
} from "./lib/schema";

type ContentPageSnapshotMessage = {
  type: "CONTENT_PAGE_SNAPSHOT";
  payload: {
    url: string;
    title: string;
    textContent: string;
    htmlContent?: string;
    reason: string;
  };
};

type IncomingMessage = ExportMessage | ContentPageSnapshotMessage;

const DEFAULT_STATE: RecorderState = {
  isRecording: false,
  isStopping: false,
  sessionId: null,
  startedAt: null,
  stoppedAt: null,
  droppedPageCount: 0,
  droppedRequestCount: 0,
  storageBytesInUse: 0,
};

const DEFAULT_SETTINGS: RecorderSettings = {
  preset: "pages_only",
  hardLimitMb: 256,
  autoExportOnSoftLimit: false,
  pollIntervalMs: 300,
  forceInitialScanOnStart: false,
  savePageText: true,
  savePageHtml: false,
  saveRequestData: false,
  savePageMeta: true,
};

let recorderState: RecorderState = { ...DEFAULT_STATE };
let recorderSettings: RecorderSettings = { ...DEFAULT_SETTINGS };
const PAGE_TEXT_LIMIT = 50_000;
const PAGE_HTML_LIMIT = 200_000;
const SNAPSHOT_MIN_INTERVAL_MS = 300;

type TabSnapshotState = {
  hash: number;
  lastAcceptedAt: number;
};

const lastSnapshotByTab = new Map<number, TabSnapshotState>();
const activeExportSessions = new Set<string>();
let queueAddChain: Promise<void> = Promise.resolve();
let consumerLoopPromise: Promise<void> | null = null;
let stopRequested = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeState(state: RecorderState | undefined): RecorderState {
  return {
    ...DEFAULT_STATE,
    ...state,
    isStopping: state?.isStopping ?? false,
  };
}

function normalizeSettings(settings: RecorderSettings | undefined): RecorderSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    hardLimitMb: Math.min(Math.max(Math.round(settings?.hardLimitMb ?? 256), 32), 1024),
    pollIntervalMs: Math.min(Math.max(Math.round(settings?.pollIntervalMs ?? 300), 100), 5_000),
  };
}

function applyPreset(settings: RecorderSettings, preset: CapturePreset): RecorderSettings {
  if (preset === "pages_only") {
    return {
      ...settings,
      preset,
      savePageText: true,
      savePageHtml: false,
      saveRequestData: false,
      savePageMeta: true,
    };
  }
  if (preset === "pages_requests") {
    return {
      ...settings,
      preset,
      savePageText: true,
      savePageHtml: false,
      saveRequestData: true,
      savePageMeta: true,
    };
  }
  return {
    ...settings,
    preset: "full_capture",
    savePageText: true,
    savePageHtml: true,
    saveRequestData: true,
    savePageMeta: true,
  };
}

function isCapturableUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return /^(https?|file):/i.test(url);
}

function urlPrefixFromUrl(url: string): string {
  try {
    return new URL(url).host || "unknown";
  } catch {
    return "unknown";
  }
}

function parseRecordTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return parsed;
}

function createSessionId(): string {
  const datePart = new Date().toISOString().replaceAll(":", "-");
  const randomPart = crypto.randomUUID().slice(0, 8);
  return `${datePart}_${randomPart}`;
}

function makeRecordId(): string {
  return crypto.randomUUID();
}

function getIndexedDbHardLimitBytes(): number {
  return recorderSettings.hardLimitMb * 1024 * 1024;
}

async function updateState(nextState: RecorderState): Promise<void> {
  recorderState = nextState;
  await chrome.storage.local.set({ [STORAGE_KEYS.state]: recorderState });
}

async function refreshStorageUsage(): Promise<void> {
  const stats = await readPipelineStats(estimateCompressedBytes);
  if (stats.totals.totalBytes !== recorderState.storageBytesInUse) {
    await updateState({
      ...recorderState,
      storageBytesInUse: stats.totals.totalBytes,
    });
  }
}

function snapshotSignatureHash(payload: {
  url: string;
  title: string;
  textContent: string;
  htmlContent?: string;
}): number {
  const sections = parseSections({
    url: payload.url,
    textContent: payload.textContent,
    htmlContent: payload.htmlContent,
  });
  const normalized = JSON.stringify({
    url: payload.url,
    title: payload.title,
    textContent: payload.textContent,
    htmlContent: payload.htmlContent ?? "",
    sections,
  });
  let hash = 0;
  for (let idx = 0; idx < normalized.length; idx += 1) {
    hash = (hash * 31 + normalized.charCodeAt(idx)) >>> 0;
  }
  return hash;
}

function shouldAppendSnapshot(
  tabId: number,
  hash: number,
  acceptedAt: number,
  reason: string,
): boolean {
  const previous = lastSnapshotByTab.get(tabId);
  if (!previous) {
    lastSnapshotByTab.set(tabId, { hash, lastAcceptedAt: acceptedAt });
    return true;
  }
  if (previous.hash === hash) {
    return false;
  }
  if (reason === "poll-diff" && acceptedAt - previous.lastAcceptedAt < SNAPSHOT_MIN_INTERVAL_MS) {
    return false;
  }
  lastSnapshotByTab.set(tabId, { hash, lastAcceptedAt: acceptedAt });
  return true;
}

function resetSnapshotStateForSession(): void {
  lastSnapshotByTab.clear();
}

async function pushSettingsToOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) =>
        chrome.tabs.sendMessage(tab.id!, {
          type: "CONTENT_UPDATE_SETTINGS",
          payload: {
            pollIntervalMs: recorderSettings.pollIntervalMs,
            savePageHtml: recorderSettings.savePageHtml,
          },
        }),
      ),
  );
}

async function initializeState(): Promise<void> {
  const storage = await chrome.storage.local.get([STORAGE_KEYS.state, STORAGE_KEYS.settings]);
  recorderState = normalizeState(storage[STORAGE_KEYS.state] as RecorderState | undefined);
  recorderSettings = normalizeSettings(
    storage[STORAGE_KEYS.settings] as RecorderSettings | undefined,
  );
  if (!storage[STORAGE_KEYS.settings]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: recorderSettings });
  }
  await refreshStorageUsage();
}

function isRecording(): boolean {
  return recorderState.isRecording;
}

async function enqueueRawSnapshot(raw: RawPageRecord, dedupeKey: string): Promise<boolean> {
  const queueRecord: QueueRecord = {
    id: makeRecordId(),
    rawId: raw.id,
    createdAt: raw.createdAt,
    tabId: raw.tabId,
    urlPrefix: raw.urlPrefix,
    dedupeKey,
    status: "pending",
    attempts: 0,
    lastUpdatedAt: raw.createdAt,
  };
  const operation = queueAddChain.then(async () => {
    const result = await addRawAndQueue(raw, queueRecord);
    if (!result.accepted) {
      throw new Error("QUEUE_DUPLICATE");
    }
  });
  queueAddChain = operation.catch(() => undefined);
  try {
    await operation;
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage === "QUEUE_DUPLICATE") {
      return false;
    }
    throw error;
  }
}

function enrichRawRecord(raw: RawPageRecord): EnrichedPageRecord {
  const sections = parseSections({
    url: raw.url,
    textContent: raw.textContent,
    htmlContent: raw.htmlContent,
  });
  return {
    id: makeRecordId(),
    createdAt: new Date().toISOString(),
    tabId: raw.tabId,
    windowId: raw.windowId,
    url: raw.url,
    urlPrefix: raw.urlPrefix,
    title: raw.title,
    reason: raw.reason,
    timestamp: raw.createdAt,
    textContent: raw.textContent || undefined,
    htmlContent: raw.htmlContent || undefined,
    sectionCount: sections.length,
    contentSizeBytes: raw.contentSizeBytes,
  };
}

async function runConsumerLoop(): Promise<void> {
  try {
    while (true) {
      if (stopRequested && !(await hasPendingQueueMessages())) {
        break;
      }
      const next = await pollNextQueueRecord();
      if (!next) {
        await sleep(120);
        continue;
      }
      const raw = await getRawPage(next.rawId);
      if (!raw) {
        await markQueueFailed(next.id, "Missing raw page record.");
        continue;
      }
      try {
        const enriched = enrichRawRecord(raw);
        await acknowledgeProcessed(next.id, next.rawId, enriched);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markQueueFailed(next.id, message);
      }
    }
  } finally {
    consumerLoopPromise = null;
    await refreshStorageUsage();
  }
}

function ensureConsumerLoopRunning(): void {
  if (consumerLoopPromise) {
    return;
  }
  stopRequested = false;
  consumerLoopPromise = runConsumerLoop();
}

async function stopAndDrainWorker(): Promise<void> {
  stopRequested = true;
  if (consumerLoopPromise) {
    await consumerLoopPromise;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const slice = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function downloadZipFile(filename: string, bytes: Uint8Array): Promise<void> {
  const base64 = bytesToBase64(bytes);
  const dataUrl = `data:application/zip;base64,${base64}`;
  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: "overwrite",
  });
}

function buildExportFilename(): string {
  const base = recorderState.sessionId ?? new Date().toISOString().replaceAll(":", "-");
  const safe = base.replaceAll(/[^\w.-]/g, "_");
  return `recordings/${safe}.zip`;
}

async function handleStartRecording(): Promise<RecorderState> {
  resetSnapshotStateForSession();
  stopRequested = false;
  await updateState({
    ...recorderState,
    isRecording: true,
    isStopping: false,
    sessionId: createSessionId(),
    startedAt: new Date().toISOString(),
    stoppedAt: null,
  });
  await pushSettingsToOpenTabs();
  ensureConsumerLoopRunning();
  return recorderState;
}

async function handleStopRecording(): Promise<RecorderState> {
  if (!recorderState.isRecording) {
    return recorderState;
  }
  await updateState({
    ...recorderState,
    isRecording: false,
    isStopping: true,
    stoppedAt: null,
  });
  await stopAndDrainWorker();
  await updateState({
    ...recorderState,
    isStopping: false,
    stoppedAt: new Date().toISOString(),
  });
  return recorderState;
}

async function handleGetSettings(): Promise<RecorderSettings> {
  return recorderSettings;
}

async function handleUpdateSettings(
  nextSettings: Partial<RecorderSettings>,
): Promise<RecorderSettings> {
  const mergeBase: RecorderSettings = {
    ...recorderSettings,
    ...nextSettings,
  };
  const shouldApplyPreset =
    typeof nextSettings.preset === "string" && Object.keys(nextSettings).length === 1;
  recorderSettings = normalizeSettings(
    shouldApplyPreset ? applyPreset(mergeBase, nextSettings.preset!) : mergeBase,
  );
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: recorderSettings });
  await pushSettingsToOpenTabs();
  return recorderSettings;
}

async function handleClearSessionData(): Promise<{ cleared: boolean }> {
  await stopAndDrainWorker();
  resetSnapshotStateForSession();
  await clearAllCaptureData();
  recorderState = { ...DEFAULT_STATE };
  await chrome.storage.local.set({ [STORAGE_KEYS.state]: recorderState });
  return { cleared: true };
}

async function handleGetPipelineStats(): Promise<PipelineStats> {
  return readPipelineStats(estimateCompressedBytes);
}

async function handleGetSessionStats(): Promise<SessionStats> {
  const stats = await handleGetPipelineStats();
  return {
    sessionId: recorderState.sessionId,
    pageCount: stats.totals.enrichedCount,
    droppedPageCount: recorderState.droppedPageCount,
    requestCount: 0,
    droppedRequestCount: recorderState.droppedRequestCount,
    hostCount: stats.urlPrefixRows.length,
    storageBytesInUse: stats.totals.totalBytes,
  };
}

async function handleGetHostQueueStats(): Promise<HostQueueStats> {
  const stats = await handleGetPipelineStats();
  const hosts: HostQueueStatsRow[] = stats.urlPrefixRows.map((row) => ({
    host: row.urlPrefix,
    mapped: true,
    queueSize: 0,
    workerActive: false,
  }));
  return {
    distinctHostCount: hosts.length,
    generatedAt: stats.generatedAt,
    hosts,
  };
}

async function handleExportSession(): Promise<{
  sessionId: string;
  pageCount: number;
  requestCount: number;
  droppedPageCount: number;
  droppedRequestCount: number;
  hostCount: number;
}> {
  if (recorderState.isRecording || (recorderState.isStopping ?? false)) {
    throw new Error("Stop recording before exporting.");
  }
  await stopAndDrainWorker();
  const pages = await listEnrichedPages();
  if (pages.length === 0) {
    throw new Error("No captured pages available to export.");
  }
  const sessionId = recorderState.sessionId ?? createSessionId();
  if (activeExportSessions.has(sessionId)) {
    throw new Error("Export already in progress.");
  }
  activeExportSessions.add(sessionId);
  try {
    const jsonl = pages
      .sort((a, b) => parseRecordTimestamp(a.timestamp) - parseRecordTimestamp(b.timestamp))
      .map((row) => JSON.stringify(row))
      .join("\n");
    const prefixCount = new Set(pages.map((row) => row.urlPrefix)).size;
    const metadata = JSON.stringify(
      {
        sessionId,
        exportedAt: new Date().toISOString(),
        pageCount: pages.length,
        urlPrefixCount: prefixCount,
        settings: recorderSettings,
      },
      null,
      2,
    );
    const zipBytes = createZip([
      { filename: "pages.jsonl", content: jsonl },
      { filename: "metadata.json", content: metadata },
    ]);
    await downloadZipFile(buildExportFilename(), zipBytes);
    return {
      sessionId,
      pageCount: pages.length,
      requestCount: 0,
      droppedPageCount: recorderState.droppedPageCount,
      droppedRequestCount: recorderState.droppedRequestCount,
      hostCount: prefixCount,
    };
  } finally {
    activeExportSessions.delete(sessionId);
  }
}

async function handleContentPageSnapshot(
  message: ContentPageSnapshotMessage,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; ignored?: boolean }> {
  if (!isRecording() || (recorderState.isStopping ?? false) || sender.tab?.id === undefined) {
    return { ok: true, ignored: true };
  }
  const acceptedAt = Date.now();
  const textContent = recorderSettings.savePageText
    ? truncateText(message.payload.textContent, PAGE_TEXT_LIMIT)
    : "";
  const htmlContent = recorderSettings.savePageHtml
    ? truncateText(message.payload.htmlContent ?? "", PAGE_HTML_LIMIT)
    : undefined;
  const hash = snapshotSignatureHash({
    url: redactUrl(message.payload.url),
    title: message.payload.title,
    textContent,
    htmlContent,
  });
  if (!shouldAppendSnapshot(sender.tab.id, hash, acceptedAt, message.payload.reason)) {
    return { ok: true, ignored: true };
  }
  if (!textContent && !htmlContent) {
    return { ok: true, ignored: true };
  }
  const redactedUrl = redactUrl(message.payload.url);
  const raw: RawPageRecord = {
    id: makeRecordId(),
    createdAt: new Date().toISOString(),
    tabId: sender.tab.id,
    windowId: sender.tab.windowId ?? -1,
    url: redactedUrl,
    urlPrefix: urlPrefixFromUrl(redactedUrl),
    title: recorderSettings.savePageMeta ? message.payload.title : "",
    reason: recorderSettings.savePageMeta ? message.payload.reason : "capture",
    textContent,
    htmlContent,
    signatureHash: hash,
    contentSizeBytes: new Blob([textContent, htmlContent ?? ""]).size,
  };
  if (recorderState.storageBytesInUse + raw.contentSizeBytes > getIndexedDbHardLimitBytes()) {
    await updateState({
      ...recorderState,
      droppedPageCount: recorderState.droppedPageCount + 1,
    });
    return { ok: true, ignored: true };
  }
  const coarseBucket = Math.floor(acceptedAt / 1_000);
  const dedupeKey = `${raw.urlPrefix}|${hash}|${coarseBucket}`;
  const accepted = await enqueueRawSnapshot(raw, dedupeKey);
  if (accepted) {
    ensureConsumerLoopRunning();
  }
  return { ok: true, ignored: !accepted };
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeState();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeState();
});

void initializeState();

chrome.webRequest.onBeforeRequest.addListener(
  () => {
    return undefined;
  },
  {
    urls: ["<all_urls>"],
  },
);

chrome.runtime.onMessage.addListener((message: IncomingMessage, sender, sendResponse) => {
  void (async () => {
    try {
      if (message.type === "GET_STATE") {
        sendResponse({ ok: true, state: recorderState });
        return;
      }
      if (message.type === "GET_SETTINGS") {
        sendResponse({ ok: true, settings: await handleGetSettings() });
        return;
      }
      if (message.type === "UPDATE_SETTINGS") {
        sendResponse({ ok: true, settings: await handleUpdateSettings(message.payload ?? {}) });
        return;
      }
      if (message.type === "START_RECORDING") {
        sendResponse({ ok: true, state: await handleStartRecording() });
        return;
      }
      if (message.type === "STOP_RECORDING") {
        sendResponse({ ok: true, state: await handleStopRecording() });
        return;
      }
      if (message.type === "CLEAR_SESSION_DATA") {
        sendResponse({ ok: true, ...(await handleClearSessionData()) });
        return;
      }
      if (message.type === "GET_SESSION_STATS") {
        sendResponse({ ok: true, stats: await handleGetSessionStats() });
        return;
      }
      if (message.type === "GET_PIPELINE_STATS") {
        sendResponse({ ok: true, stats: await handleGetPipelineStats() });
        return;
      }
      if (message.type === "GET_HOST_QUEUE_STATS") {
        sendResponse({ ok: true, stats: await handleGetHostQueueStats() });
        return;
      }
      if (message.type === "EXPORT_SESSION") {
        sendResponse({ ok: true, ...(await handleExportSession()) });
        return;
      }
      if (message.type === "CONTENT_PAGE_SNAPSHOT") {
        sendResponse(await handleContentPageSnapshot(message, sender));
        return;
      }
      sendResponse({ ok: false, error: "Unhandled message type." });
    } catch (error) {
      const messageValue = error instanceof Error ? error.message : String(error);
      sendResponse({ ok: false, error: messageValue });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastSnapshotByTab.delete(tabId);
});

async function getRecords<T>(
  key: typeof STORAGE_KEYS.pages | typeof STORAGE_KEYS.requests,
): Promise<T[]> {
  const current = await chrome.storage.local.get(key);
  const value = current[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

export const __testHooks = {
  parseRecordTimestamp,
  getRecords,
  isCapturableUrl,
  snapshotSignatureHash,
  shouldAppendSnapshot,
  resetSnapshotStateForSession,
  handleGetSessionStats,
  handleGetHostQueueStats,
  handleExportSession,
  handleClearSessionData,
};
