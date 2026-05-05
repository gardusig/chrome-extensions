import {
  appendSnapshotAndLedger,
  clearAllStores,
  clearPolledUniqueStore,
  estimateTrimPlanToTargetBytes,
  estimateBytesStore1,
  estimateBytesStores23,
  getPolledUnique,
  listProcessedForExport,
  trimStores23ToTargetBytes,
  tryPutPolledUnique,
} from "./lib/db";
import * as digestQueue from "./lib/digest-queue";
import { extractHeadMeta, type HeadMeta } from "./lib/head-meta";
import { redactUrl } from "./lib/redact";
import { buildSnapshotBlockText, type RequestSummary } from "./lib/snapshot-block";
import { sha256Hex } from "./lib/sha256";
import { buildExportZipBytes, exportZipBasename } from "./lib/recorder-export";
import {
  STORAGE_KEYS,
  type ClearSuggestion,
  type ExportMessage,
  type RecorderSettings,
  type RecorderState,
  type SessionStats,
} from "./lib/schema";

type CapturePayload = {
  outerHTML: string;
  url: string;
  title: string;
  tabId: number;
  windowId: number;
  headMeta?: HeadMeta;
};

type IncomingMessage = ExportMessage | { type: "RECORDER_CAPTURE"; payload: CapturePayload };
type RecorderRecordingBroadcastMessage = {
  type: "RECORDER_RECORDING";
  recording: boolean;
  pollIntervalMs: number;
  immediatePoll?: boolean;
};

type PendingRequestRecord = {
  requestId: string;
  tabId: number;
  method: string;
  url: string;
  requestPayloadBytes?: number | null;
  requestContentType?: string;
};

function mergeCapturePayload(
  payload: CapturePayload,
  sender: chrome.runtime.MessageSender,
): CapturePayload {
  const tabId = sender.tab?.id ?? payload.tabId;
  const windowId = sender.tab?.windowId ?? payload.windowId;
  return { ...payload, tabId, windowId };
}

const DEFAULT_STATE: RecorderState = {
  isRecording: false,
  sessionId: null,
  startedAt: null,
  stoppedAt: null,
  storageBytesTotal: 0,
  storageBytesRaw: 0,
  storageBytesProcessed: 0,
};

const DEFAULT_SETTINGS: RecorderSettings = {
  pollIntervalMs: 500,
  limitForceStopMb: 32,
  targetAfterCleanupMb: 16,
};

let recorderState: RecorderState = { ...DEFAULT_STATE };
let recorderSettings: RecorderSettings = { ...DEFAULT_SETTINGS };
const RECENT_REQUESTS_PER_TAB_LIMIT = 300;
const REQUESTS_PER_SNAPSHOT_LIMIT = 100;
const REQUESTS_URL_FILTER = { urls: ["<all_urls>"] };
const pendingRequestsById = new Map<string, PendingRequestRecord>();
const pendingRequestsByTab = new Map<number, RequestSummary[]>();

function normalizeSettings(s: RecorderSettings | undefined): RecorderSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    pollIntervalMs: Math.min(Math.max(Math.round(s?.pollIntervalMs ?? 500), 100), 5000),
    limitForceStopMb: Math.min(Math.max(s?.limitForceStopMb ?? 32, 8), 2048),
    targetAfterCleanupMb: Math.min(Math.max(s?.targetAfterCleanupMb ?? 16, 4), 1024),
  };
}

function normalizeState(s: RecorderState | undefined): RecorderState {
  const m: RecorderState = { ...DEFAULT_STATE, ...s };
  for (const key of ["storageBytesTotal", "storageBytesRaw", "storageBytesProcessed"] as const) {
    if (typeof m[key] !== "number" || Number.isNaN(m[key])) {
      m[key] = DEFAULT_STATE[key];
    }
  }
  m.isRecording = Boolean(m.isRecording);
  m.sessionId = m.sessionId ?? null;
  m.startedAt = m.startedAt ?? null;
  m.stoppedAt = m.stoppedAt ?? null;
  m.forceStoppedForLimit = Boolean(m.forceStoppedForLimit);
  m.recordingBlockedForLimit = Boolean(m.recordingBlockedForLimit);
  return m;
}

/** MV3 service workers do not implement `URL.createObjectURL`; use a data URL for `chrome.downloads`. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Could not build download URL for export."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed."));
    reader.readAsDataURL(blob);
  });
}

async function loadStateAndSettings(): Promise<void> {
  const data = await chrome.storage.local.get([STORAGE_KEYS.state, STORAGE_KEYS.settings]);
  recorderState = normalizeState(data[STORAGE_KEYS.state] as RecorderState | undefined);
  recorderSettings = normalizeSettings(data[STORAGE_KEYS.settings] as RecorderSettings | undefined);
}

async function persistState(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.state]: recorderState });
}

async function persistSettings(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: recorderSettings });
}

function limitBytes(): number {
  return recorderSettings.limitForceStopMb * 1024 * 1024;
}

function shouldBlockRecordingStart(processedBytes: number): boolean {
  return processedBytes >= limitBytes();
}

function isCapturableTabUrl(url?: string): boolean {
  if (!url) {
    return false;
  }
  return url.startsWith("http://") || url.startsWith("https://");
}

function trimAndPushRequest(tabId: number, request: RequestSummary): void {
  const queue = pendingRequestsByTab.get(tabId) ?? [];
  queue.push(request);
  while (queue.length > RECENT_REQUESTS_PER_TAB_LIMIT) {
    queue.shift();
  }
  pendingRequestsByTab.set(tabId, queue);
}

function consumePendingRequestsForTab(tabId: number): RequestSummary[] | undefined {
  const queue = pendingRequestsByTab.get(tabId);
  if (!queue || queue.length === 0) {
    return undefined;
  }
  pendingRequestsByTab.set(tabId, []);
  if (queue.length <= REQUESTS_PER_SNAPSHOT_LIMIT) {
    return queue;
  }
  return queue.slice(queue.length - REQUESTS_PER_SNAPSHOT_LIMIT);
}

function extractRequestBodyBytes(details: chrome.webRequest.OnBeforeRequestDetails): number | null {
  const body = details.requestBody;
  if (!body) {
    return null;
  }
  let sum = 0;
  if (body.raw) {
    for (const entry of body.raw) {
      if (entry.bytes) {
        sum += entry.bytes.byteLength;
      }
    }
  }
  if (sum > 0) {
    return sum;
  }
  if (body.formData) {
    const serialized = JSON.stringify(body.formData);
    return new TextEncoder().encode(serialized).byteLength;
  }
  return null;
}

function contentTypeFromHeaders(headers?: chrome.webRequest.HttpHeader[]): string | undefined {
  if (!headers) {
    return undefined;
  }
  for (const header of headers) {
    if ((header.name ?? "").toLowerCase() === "content-type") {
      return header.value;
    }
  }
  return undefined;
}

function responseBytesFromHeaders(headers?: chrome.webRequest.HttpHeader[]): number | null {
  if (!headers) {
    return null;
  }
  for (const header of headers) {
    if ((header.name ?? "").toLowerCase() === "content-length") {
      const value = Number(header.value ?? "");
      if (Number.isFinite(value) && value >= 0) {
        return value;
      }
      return null;
    }
  }
  return null;
}

function onBeforeRequest(
  details: chrome.webRequest.OnBeforeRequestDetails,
): chrome.webRequest.BlockingResponse | undefined {
  if (!recorderState.isRecording || details.tabId < 0) {
    return undefined;
  }
  pendingRequestsById.set(details.requestId, {
    requestId: details.requestId,
    tabId: details.tabId,
    method: details.method ?? "GET",
    url: redactUrl(details.url),
    requestPayloadBytes: extractRequestBodyBytes(details),
  });
  return undefined;
}

function onCompleted(details: chrome.webRequest.OnCompletedDetails): void {
  if (!recorderState.isRecording || details.tabId < 0) {
    return;
  }
  const pending = pendingRequestsById.get(details.requestId);
  const request: RequestSummary = {
    url: redactUrl(details.url),
    method: pending?.method ?? details.method ?? "GET",
    requestPayloadBytes: pending?.requestPayloadBytes,
    requestContentType: pending?.requestContentType,
    responseStatus: details.statusCode,
    responseBytes: responseBytesFromHeaders(details.responseHeaders),
    responseContentType: contentTypeFromHeaders(details.responseHeaders),
  };
  trimAndPushRequest(details.tabId, request);
  pendingRequestsById.delete(details.requestId);
}

async function refreshStorageEstimates(): Promise<void> {
  const raw = await estimateBytesStore1();
  const proc = await estimateBytesStores23();
  recorderState.storageBytesRaw = raw;
  recorderState.storageBytesProcessed = proc;
  recorderState.storageBytesTotal = raw + proc;
  const blocked = !recorderState.isRecording && shouldBlockRecordingStart(proc);
  recorderState.recordingBlockedForLimit = blocked;
  if (!blocked) {
    recorderState.forceStoppedForLimit = false;
  }
  await persistState();
}

async function buildExportZip(): Promise<Uint8Array> {
  const rows = await listProcessedForExport();
  return buildExportZipBytes(rows);
}

async function processDigest(digest: string): Promise<void> {
  const row = await getPolledUnique(digest);
  if (!row) {
    return;
  }
  const headMeta = row.headMeta ?? extractHeadMeta(row.rawHtml);
  const text = buildSnapshotBlockText({
    fullUrl: row.fullUrl,
    capturedAt: row.capturedAt,
    tabId: row.tabId,
    windowId: row.windowId,
    title: row.title,
    headMeta,
    rawHtml: row.rawHtml,
    requests: consumePendingRequestsForTab(row.tabId),
  });
  const snapshotId = crypto.randomUUID();
  await appendSnapshotAndLedger(row.fullUrl, snapshotId, text);
}

async function drainWorker(): Promise<void> {
  while (digestQueue.digestQueueLength() > 0) {
    const digest = digestQueue.popDigest();
    if (!digest) {
      break;
    }
    await processDigest(digest);
  }
}

async function ingestCapture(payload: CapturePayload): Promise<void> {
  if (!recorderState.isRecording) {
    return;
  }
  const digest = await sha256Hex(payload.outerHTML);
  const capturedAt = new Date().toISOString();
  const inserted = await tryPutPolledUnique({
    digest,
    rawHtml: payload.outerHTML,
    fullUrl: payload.url,
    title: payload.title,
    capturedAt,
    tabId: payload.tabId,
    windowId: payload.windowId,
    headMeta: payload.headMeta,
  });
  if (!inserted) {
    return;
  }
  digestQueue.pushDigest(digest);
  await drainWorker();
  await refreshStorageEstimates();

  if ((await estimateBytesStores23()) > limitBytes()) {
    await stopRecordingSession(true);
  }
}

async function broadcastToTab(
  tab: chrome.tabs.Tab,
  message: RecorderRecordingBroadcastMessage,
): Promise<void> {
  if (tab.id === undefined) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, message);
    return;
  } catch {
    if (!message.recording || !isCapturableTabUrl(tab.url)) {
      return;
    }
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    /* restricted tab or injection unavailable */
  }
}

async function broadcastRecording(active: boolean, immediatePoll = false): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const message: RecorderRecordingBroadcastMessage = {
    type: "RECORDER_RECORDING",
    recording: active,
    pollIntervalMs: recorderSettings.pollIntervalMs,
    immediatePoll,
  };
  await Promise.all(tabs.map(async (tab) => broadcastToTab(tab, message)));
}

async function startRecordingSession(): Promise<void> {
  await refreshStorageEstimates();
  if (shouldBlockRecordingStart(recorderState.storageBytesProcessed)) {
    recorderState.recordingBlockedForLimit = true;
    await persistState();
    throw new Error("Clear old snapshots before starting: output+ledger is above limit.");
  }
  const sessionId = crypto.randomUUID();
  recorderState = {
    ...recorderState,
    isRecording: true,
    sessionId,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    forceStoppedForLimit: false,
    recordingBlockedForLimit: false,
  };
  await persistState();
  await broadcastRecording(true, true);
  await refreshStorageEstimates();
}

async function stopRecordingSession(forceLimit = false): Promise<void> {
  recorderState.isRecording = false;
  recorderState.stoppedAt = new Date().toISOString();
  if (forceLimit) {
    recorderState.forceStoppedForLimit = true;
  }
  await broadcastRecording(false);
  await drainWorker();
  digestQueue.clearDigestQueue();
  pendingRequestsById.clear();
  pendingRequestsByTab.clear();
  await clearPolledUniqueStore();
  await refreshStorageEstimates();
  await persistState();
}

async function sessionStats(): Promise<SessionStats> {
  const rows = await listProcessedForExport();
  let snapshotCount = 0;
  for (const r of rows) {
    snapshotCount += r.snapshots.length;
  }
  const raw = await estimateBytesStore1();
  const proc = await estimateBytesStores23();
  return {
    urlCount: rows.length,
    snapshotCount,
    storageBytesRaw: raw,
    storageBytesProcessed: proc,
    storageBytesTotal: raw + proc,
  };
}

async function clearSuggestions(): Promise<ClearSuggestion[]> {
  const current = await estimateBytesStores23();
  if (current <= 0) {
    return [];
  }
  const limit = limitBytes();
  const candidateTargets = [
    { id: "under-limit", label: "Trim enough to go under limit", target: Math.max(0, limit - 1) },
    {
      id: "free-8mb",
      label: "Free about 8 MB (oldest first)",
      target: Math.max(0, current - 8 * 1024 * 1024),
    },
    {
      id: "free-16mb",
      label: "Free about 16 MB (oldest first)",
      target: Math.max(0, current - 16 * 1024 * 1024),
    },
    {
      id: "target-after-cleanup",
      label: "Trim to configured target",
      target: recorderSettings.targetAfterCleanupMb * 1024 * 1024,
    },
  ];

  const seenTargets = new Set<number>();
  const suggestions: ClearSuggestion[] = [];
  for (const candidate of candidateTargets) {
    if (candidate.target >= current || seenTargets.has(candidate.target)) {
      continue;
    }
    seenTargets.add(candidate.target);
    const plan = await estimateTrimPlanToTargetBytes(candidate.target);
    if (plan.snapshotsToRemove <= 0 || plan.estimatedBytesFreed <= 0) {
      continue;
    }
    suggestions.push({
      id: candidate.id,
      label: candidate.label,
      targetBytes: candidate.target,
      snapshotsToRemove: plan.snapshotsToRemove,
      estimatedBytesFreed: plan.estimatedBytesFreed,
      projectedBytesAfter: plan.projectedBytesAfter,
    });
  }
  return suggestions;
}

chrome.runtime.onInstalled.addListener(() => {
  void loadStateAndSettings();
});

chrome.runtime.onStartup?.addListener(() => {
  void loadStateAndSettings();
});

chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, REQUESTS_URL_FILTER, [
  "requestBody",
]);
chrome.webRequest.onCompleted.addListener(onCompleted, REQUESTS_URL_FILTER, ["responseHeaders"]);

chrome.runtime.onMessage.addListener(
  (
    message: IncomingMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (r: unknown) => void,
  ) => {
    void (async () => {
      try {
        if (message.type === "RECORDER_CAPTURE") {
          const merged = mergeCapturePayload(
            (message as { payload: CapturePayload }).payload,
            sender,
          );
          await ingestCapture(merged);
          sendResponse({ ok: true });
          return;
        }
        if (message.type === "GET_STATE") {
          await refreshStorageEstimates();
          sendResponse({ ok: true, state: recorderState });
          return;
        }
        if (message.type === "GET_SESSION_STATS") {
          await refreshStorageEstimates();
          sendResponse({ ok: true, stats: await sessionStats() });
          return;
        }
        if (message.type === "GET_SETTINGS") {
          sendResponse({ ok: true, settings: recorderSettings });
          return;
        }
        if (message.type === "UPDATE_SETTINGS") {
          recorderSettings = normalizeSettings({
            ...recorderSettings,
            ...(message as { payload?: Partial<RecorderSettings> }).payload,
          });
          await persistSettings();
          if (recorderState.isRecording) {
            await broadcastRecording(true);
          }
          await refreshStorageEstimates();
          sendResponse({ ok: true, settings: recorderSettings });
          return;
        }
        if (message.type === "START_RECORDING") {
          await startRecordingSession();
          sendResponse({ ok: true, state: recorderState });
          return;
        }
        if (message.type === "STOP_RECORDING") {
          await stopRecordingSession(false);
          sendResponse({ ok: true, state: recorderState });
          return;
        }
        if (message.type === "EXPORT_SESSION") {
          if (recorderState.isRecording) {
            sendResponse({ ok: false, error: "Stop recording before export." });
            return;
          }
          const zip = await buildExportZip();
          const blob = new Blob([new Uint8Array(zip)], { type: "application/zip" });
          const dataUrl = await blobToDataUrl(blob);
          await chrome.downloads.download({
            url: dataUrl,
            filename: exportZipBasename(),
            saveAs: false,
          });
          sendResponse({
            ok: true,
            sessionId: recorderState.sessionId,
            urlCount: (await listProcessedForExport()).length,
            snapshotCount: (await sessionStats()).snapshotCount,
          });
          return;
        }
        if (message.type === "CLEAR_TRIM") {
          if (recorderState.isRecording) {
            sendResponse({ ok: false, error: "Stop recording before clear." });
            return;
          }
          const targetBytes = recorderSettings.targetAfterCleanupMb * 1024 * 1024;
          await trimStores23ToTargetBytes(targetBytes);
          await refreshStorageEstimates();
          sendResponse({ ok: true });
          return;
        }
        if (message.type === "GET_CLEAR_SUGGESTIONS") {
          if (recorderState.isRecording) {
            sendResponse({ ok: false, error: "Stop recording before clear." });
            return;
          }
          sendResponse({ ok: true, suggestions: await clearSuggestions() });
          return;
        }
        if (message.type === "CLEAR_TRIM_TO_TARGET") {
          if (recorderState.isRecording) {
            sendResponse({ ok: false, error: "Stop recording before clear." });
            return;
          }
          const targetBytes = Math.max(0, message.payload?.targetBytes ?? 0);
          await trimStores23ToTargetBytes(targetBytes);
          await refreshStorageEstimates();
          sendResponse({ ok: true });
          return;
        }
        if (message.type === "CLEAR_FULL") {
          if (recorderState.isRecording) {
            sendResponse({ ok: false, error: "Stop recording before clear." });
            return;
          }
          digestQueue.clearDigestQueue();
          await clearAllStores();
          await refreshStorageEstimates();
          sendResponse({ ok: true });
          return;
        }
        sendResponse({ ok: false, error: "Unknown message type." });
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: err });
      }
    })();
    return true;
  },
);

void loadStateAndSettings();
