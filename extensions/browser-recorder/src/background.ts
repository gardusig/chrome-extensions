import { redactUrl, truncateText } from "./lib/redact";
import {
  acknowledgeDiscarded,
  acknowledgeProcessed,
  addRawAndQueue,
  clearAllCaptureData,
  getRawPage,
  hasEnrichedSignature,
  hasPendingQueueMessages,
  listEnrichedPages,
  markQueueFailed,
  pollNextQueueRecord,
  readPipelineStats,
  type EnrichedPageRecord,
  type QueueRecord,
  type RawPageRecord,
} from "./lib/db";
import { effectiveSizeBytes } from "./lib/metrics";
import { parseSections } from "./lib/section-parsers/registry";
import { transformHtmlToIndentedText } from "./lib/html-textify";
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
  type SemanticCaptureLevel,
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
  hardLimitMb: 32,
  autoExportOnSoftLimit: false,
  pollIntervalMs: 100,
  forceInitialScanOnStart: false,
  semanticCaptureLevel: "minimal",
  savePageText: true,
  savePageHtml: false,
  saveRequestData: false,
  savePageMeta: true,
  saveExportMetadata: false,
};

let recorderState: RecorderState = { ...DEFAULT_STATE };
let recorderSettings: RecorderSettings = { ...DEFAULT_SETTINGS };
const PAGE_TEXT_LIMIT = 50_000;
const PAGE_HTML_LIMIT = 200_000;
const SNAPSHOT_MIN_INTERVAL_MS = 100;
const CONSUMER_IDLE_SLEEP_MS = 120;
const MAX_HARD_LIMIT_MB = 1152;

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
  const semanticCaptureLevel = settings?.semanticCaptureLevel;
  const normalizedSemanticCaptureLevel: SemanticCaptureLevel =
    semanticCaptureLevel === "off" ||
    semanticCaptureLevel === "minimal" ||
    semanticCaptureLevel === "medium" ||
    semanticCaptureLevel === "full"
      ? semanticCaptureLevel
      : DEFAULT_SETTINGS.semanticCaptureLevel;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    hardLimitMb: Math.min(Math.max(Math.round(settings?.hardLimitMb ?? 32), 32), MAX_HARD_LIMIT_MB),
    pollIntervalMs: Math.min(Math.max(Math.round(settings?.pollIntervalMs ?? 100), 100), 5_000),
    semanticCaptureLevel: normalizedSemanticCaptureLevel,
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
  const stats = await readPipelineStats(effectiveSizeBytes);
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
            semanticCaptureLevel: recorderSettings.semanticCaptureLevel,
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

async function enqueueRawSnapshot(raw: RawPageRecord): Promise<boolean> {
  const queueRecord: QueueRecord = {
    id: makeRecordId(),
    rawId: raw.id,
    createdAt: raw.createdAt,
    tabId: raw.tabId,
    urlPrefix: raw.urlPrefix,
    dedupeKey: raw.id,
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

function enrichRawRecord(raw: RawPageRecord, signatureHash: number): EnrichedPageRecord {
  const htmlContent = transformHtmlToIndentedText(raw.htmlContent);
  const sections = parseSections({
    url: raw.url,
    textContent: raw.textContent,
    htmlContent,
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
    htmlContent: htmlContent || undefined,
    signatureHash,
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
        await sleep(CONSUMER_IDLE_SLEEP_MS);
        continue;
      }
      const raw = await getRawPage(next.rawId);
      if (!raw) {
        await markQueueFailed(next.id, "Missing raw page record.");
        continue;
      }
      try {
        const signatureHash = snapshotSignatureHash({
          url: raw.url,
          title: raw.title,
          textContent: raw.textContent,
          htmlContent: raw.htmlContent,
        });
        const alreadySeen = await hasEnrichedSignature(raw.url, signatureHash);
        if (alreadySeen) {
          await acknowledgeDiscarded(next.id, next.rawId);
          continue;
        }
        const enriched = enrichRawRecord(raw, signatureHash);
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

function sanitizeZipPathPart(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unknown";
  }
  const safe = trimmed.replaceAll(/[^\w.-]/g, "_");
  return safe.length > 0 ? safe : "unknown";
}

type UrlSummary = {
  url: string;
  snapshotCount: number;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
};

type WebsiteSummary = {
  urlPrefix: string;
  snapshotCount: number;
  uniqueUrlCount: number;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  pages: UrlSummary[];
};

type SessionSummary = {
  websiteCount: number;
  urlCount: number;
  snapshotCount: number;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  websites: WebsiteSummary[];
};

type ExportMetadata = {
  sessionId: string;
  exportedAt: string;
  pageCount: number;
  urlCount: number;
  summary: {
    websitesOpened: number;
    urlsCaptured: number;
    snapshotCount: number;
    startedAt: string | null;
    endedAt: string | null;
    durationSeconds: number | null;
  };
  websites: WebsiteSummary[];
  index: {
    sessionId: string;
    exportedAt: string;
    websitesOpened: number;
    urlsCaptured: number;
    snapshotCount: number;
    startedAt: string | null;
    endedAt: string | null;
    durationSeconds: number | null;
    websites: WebsiteSummary[];
  };
  compaction: {
    semanticChunksRaw: number;
    semanticChunksOmitted: number;
    snapshotsCompacted: number;
    bodyBlocksRaw: number;
    bodyBlocksOmitted: number;
    snapshotsBodyCompacted: number;
  };
  /** Single balanced KPI plus component yields; only present when export metadata is enabled. */
  exportMetrics: ExportMetrics;
  settings: RecorderSettings;
};

type ExportCompactionStats = {
  semanticChunksRaw: number;
  semanticChunksOmitted: number;
  snapshotsCompacted: number;
  bodyBlocksRaw: number;
  bodyBlocksOmitted: number;
  snapshotsBodyCompacted: number;
};

type ExportMetrics = {
  /** Midpoint between UTF-8 size of page text entries and the zip payload size (excludes metadata.json). */
  payloadSizeBytes: number;
  /** `semanticChunksOmitted / semanticChunksRaw` when raw > 0. */
  semanticCompactionYield: number | null;
  /** `bodyBlocksOmitted / bodyBlocksRaw` when raw > 0. */
  bodyCompactionYield: number | null;
  /** Mean of available yields (0–1); middle-ground score for redundancy removed vs captured. */
  captureEfficiencyScore: number | null;
};

function toTimestampMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function durationSecondsFrom(startMs: number | null, endMs: number | null): number | null {
  if (startMs === null || endMs === null || endMs < startMs) {
    return null;
  }
  return Math.round(((endMs - startMs) / 1000) * 10) / 10;
}

function summarizeUrlRows(rows: EnrichedPageRecord[]): UrlSummary[] {
  const byUrl = new Map<string, EnrichedPageRecord[]>();
  for (const row of rows) {
    const existing = byUrl.get(row.url);
    if (existing) {
      existing.push(row);
    } else {
      byUrl.set(row.url, [row]);
    }
  }
  return [...byUrl.entries()]
    .map(([url, urlRows]) => {
      const sorted = [...urlRows].sort(
        (a, b) => parseRecordTimestamp(a.timestamp) - parseRecordTimestamp(b.timestamp),
      );
      const startedAt = sorted[0]?.timestamp ?? null;
      const endedAt = sorted[sorted.length - 1]?.timestamp ?? null;
      return {
        url,
        snapshotCount: sorted.length,
        startedAt,
        endedAt,
        durationSeconds: durationSecondsFrom(
          startedAt ? toTimestampMs(startedAt) : null,
          endedAt ? toTimestampMs(endedAt) : null,
        ),
      };
    })
    .sort((a, b) => b.snapshotCount - a.snapshotCount || a.url.localeCompare(b.url));
}

function buildSessionSummary(pages: EnrichedPageRecord[]): SessionSummary {
  const byPrefix = new Map<string, EnrichedPageRecord[]>();
  for (const page of pages) {
    const key = page.urlPrefix || "unknown";
    const existing = byPrefix.get(key);
    if (existing) {
      existing.push(page);
    } else {
      byPrefix.set(key, [page]);
    }
  }
  const websites: WebsiteSummary[] = [...byPrefix.entries()]
    .map(([urlPrefix, rows]) => {
      const sorted = [...rows].sort(
        (a, b) => parseRecordTimestamp(a.timestamp) - parseRecordTimestamp(b.timestamp),
      );
      const startedAt = sorted[0]?.timestamp ?? null;
      const endedAt = sorted[sorted.length - 1]?.timestamp ?? null;
      const pagesByUrl = summarizeUrlRows(sorted);
      return {
        urlPrefix,
        snapshotCount: sorted.length,
        uniqueUrlCount: pagesByUrl.length,
        startedAt,
        endedAt,
        durationSeconds: durationSecondsFrom(
          startedAt ? toTimestampMs(startedAt) : null,
          endedAt ? toTimestampMs(endedAt) : null,
        ),
        pages: pagesByUrl,
      };
    })
    .sort((a, b) => b.snapshotCount - a.snapshotCount || a.urlPrefix.localeCompare(b.urlPrefix));

  const sortedAll = [...pages].sort(
    (a, b) => parseRecordTimestamp(a.timestamp) - parseRecordTimestamp(b.timestamp),
  );
  const startedAt = sortedAll[0]?.timestamp ?? null;
  const endedAt = sortedAll[sortedAll.length - 1]?.timestamp ?? null;

  return {
    websiteCount: websites.length,
    urlCount: new Set(pages.map((page) => page.url)).size,
    snapshotCount: pages.length,
    startedAt,
    endedAt,
    durationSeconds: durationSecondsFrom(
      startedAt ? toTimestampMs(startedAt) : null,
      endedAt ? toTimestampMs(endedAt) : null,
    ),
    websites,
  };
}

function computeExportMetrics(
  compaction: ExportCompactionStats,
  uncompressedTextBytes: number,
  zipPayloadBytes: number,
): ExportMetrics {
  const payloadSizeBytes =
    uncompressedTextBytes > 0 || zipPayloadBytes > 0
      ? Math.round((uncompressedTextBytes + zipPayloadBytes) / 2)
      : 0;
  const semanticCompactionYield =
    compaction.semanticChunksRaw > 0
      ? compaction.semanticChunksOmitted / compaction.semanticChunksRaw
      : null;
  const bodyCompactionYield =
    compaction.bodyBlocksRaw > 0 ? compaction.bodyBlocksOmitted / compaction.bodyBlocksRaw : null;
  const yields: number[] = [];
  if (semanticCompactionYield !== null) {
    yields.push(semanticCompactionYield);
  }
  if (bodyCompactionYield !== null) {
    yields.push(bodyCompactionYield);
  }
  const captureEfficiencyScore =
    yields.length > 0 ? yields.reduce((a, b) => a + b, 0) / yields.length : null;
  return {
    payloadSizeBytes,
    semanticCompactionYield,
    bodyCompactionYield,
    captureEfficiencyScore,
  };
}

function buildSessionIndex(
  summary: SessionSummary,
  sessionId: string,
  exportedAt: string,
): ExportMetadata["index"] {
  return {
    sessionId,
    exportedAt,
    websitesOpened: summary.websiteCount,
    urlsCaptured: summary.urlCount,
    snapshotCount: summary.snapshotCount,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    durationSeconds: summary.durationSeconds,
    websites: summary.websites,
  };
}

function buildExportMetadata(params: {
  sessionId: string;
  exportedAt: string;
  pageCount: number;
  summary: SessionSummary;
  index: ExportMetadata["index"];
  compaction: ExportCompactionStats;
  exportMetrics: ExportMetrics;
  settings: RecorderSettings;
}): ExportMetadata {
  const { sessionId, exportedAt, pageCount, summary, index, compaction, exportMetrics, settings } =
    params;
  return {
    sessionId,
    exportedAt,
    pageCount,
    urlCount: summary.urlCount,
    summary: {
      websitesOpened: summary.websiteCount,
      urlsCaptured: summary.urlCount,
      snapshotCount: summary.snapshotCount,
      startedAt: summary.startedAt,
      endedAt: summary.endedAt,
      durationSeconds: summary.durationSeconds,
    },
    websites: summary.websites,
    index,
    compaction,
    exportMetrics,
    settings,
  };
}

function splitSnapshotTextChunks(textContent: string): {
  semanticChunks: string[];
  nonSemanticChunks: string[];
} {
  const semanticChunks: string[] = [];
  const nonSemanticChunks: string[] = [];
  for (const chunk of textContent.split(/\n{2,}/)) {
    const normalized = chunk.trim();
    if (!normalized) {
      continue;
    }
    if (normalized.startsWith("[source=semantic ")) {
      semanticChunks.push(normalized);
      continue;
    }
    nonSemanticChunks.push(normalized);
  }
  return {
    semanticChunks,
    nonSemanticChunks,
  };
}

function extractBodyChunk(nonSemanticChunks: string[]): {
  bodyChunk: string | null;
  otherChunks: string[];
} {
  const idx = nonSemanticChunks.findIndex((chunk) => chunk.startsWith("[source=body "));
  if (idx === -1) {
    return { bodyChunk: null, otherChunks: nonSemanticChunks };
  }
  const bodyChunk = nonSemanticChunks[idx] ?? null;
  const otherChunks = [...nonSemanticChunks.slice(0, idx), ...nonSemanticChunks.slice(idx + 1)];
  return { bodyChunk, otherChunks };
}

function compactSnapshotText(
  textContent: string,
  previousSemanticSignature: string | null,
  previousBodySignature: string | null,
): {
  textContent: string;
  semanticSignature: string | null;
  bodySignature: string | null;
  omittedSemanticChunks: number;
  omittedBodyBlocks: number;
} {
  const { semanticChunks, nonSemanticChunks } = splitSnapshotTextChunks(textContent);
  const { bodyChunk, otherChunks } = extractBodyChunk(nonSemanticChunks);
  const semanticJoined = semanticChunks.join("\n\n");
  const semanticSignatureOrNull = semanticChunks.length > 0 ? semanticJoined : null;

  const semSame =
    previousSemanticSignature !== null &&
    semanticChunks.length > 0 &&
    semanticJoined === previousSemanticSignature;
  const bodySame =
    previousBodySignature !== null && bodyChunk !== null && bodyChunk === previousBodySignature;

  const semanticPart = semSame
    ? `[source=semantic selector=__compacted__ kind=info]\n<unchanged-from-previous-snapshot>`
    : semanticChunks.length > 0
      ? semanticChunks.join("\n\n")
      : "";

  const bodyPart =
    bodySame && bodyChunk
      ? `[source=body selector=__compacted__ kind=info]\n<unchanged-from-previous-snapshot>`
      : (bodyChunk ?? "");

  const parts: string[] = [];
  if (bodyPart) {
    parts.push(bodyPart);
  }
  if (otherChunks.length > 0) {
    parts.push(otherChunks.join("\n\n"));
  }
  if (semanticPart) {
    parts.push(semanticPart);
  }

  const textOut = parts.join("\n\n").trim();
  return {
    textContent: textOut.length > 0 ? textOut : "<empty>",
    semanticSignature: semanticSignatureOrNull,
    bodySignature: bodyChunk,
    omittedSemanticChunks: semSame ? semanticChunks.length : 0,
    omittedBodyBlocks: bodySame && bodyChunk ? 1 : 0,
  };
}

function buildPrefixPageTextBlocks(params: { pages: EnrichedPageRecord[] }): {
  content: string;
  stats: ExportCompactionStats;
} {
  const sortedPages = [...params.pages].sort(
    (a, b) => parseRecordTimestamp(a.timestamp) - parseRecordTimestamp(b.timestamp),
  );
  if (sortedPages.length === 0) {
    return {
      content: "",
      stats: {
        semanticChunksRaw: 0,
        semanticChunksOmitted: 0,
        snapshotsCompacted: 0,
        bodyBlocksRaw: 0,
        bodyBlocksOmitted: 0,
        snapshotsBodyCompacted: 0,
      },
    };
  }

  const uniqueValues = <T extends string | number>(values: T[]): T[] =>
    [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
  const startedAt = sortedPages[0]?.timestamp ?? null;
  const endedAt = sortedPages[sortedPages.length - 1]?.timestamp ?? null;
  const startedAtMs = startedAt ? toTimestampMs(startedAt) : null;
  const endedAtMs = endedAt ? toTimestampMs(endedAt) : null;

  const titleValues = uniqueValues(
    sortedPages.map((page) => page.title).filter((value): value is string => Boolean(value)),
  );
  const reasonValues = uniqueValues(
    sortedPages.map((page) => page.reason).filter((value): value is string => Boolean(value)),
  );
  const tabIdValues = uniqueValues(sortedPages.map((page) => page.tabId));
  const windowIdValues = uniqueValues(sortedPages.map((page) => page.windowId));
  const headerLines: string[] = [
    "# Page Index",
    `url: ${sortedPages[0].url}`,
    `startedAt: ${startedAt ?? "-"}`,
    `endedAt: ${endedAt ?? "-"}`,
    `durationSeconds: ${durationSecondsFrom(startedAtMs, endedAtMs) ?? "-"}`,
    `snapshotCount: ${sortedPages.length}`,
    `titles: ${titleValues.length > 0 ? titleValues.join(" | ") : "-"}`,
    `reasons: ${reasonValues.length > 0 ? reasonValues.join(" | ") : "-"}`,
    `tabIds: ${tabIdValues.join(",")}`,
    `windowIds: ${windowIdValues.join(",")}`,
    "",
  ];

  let previousSemanticSignature: string | null = null;
  let previousBodySignature: string | null = null;
  const stats: ExportCompactionStats = {
    semanticChunksRaw: 0,
    semanticChunksOmitted: 0,
    snapshotsCompacted: 0,
    bodyBlocksRaw: 0,
    bodyBlocksOmitted: 0,
    snapshotsBodyCompacted: 0,
  };
  const bodyContent = sortedPages
    .map((page) => {
      const lines: string[] = ["---", "content:"];
      const rawContent = (page.textContent ?? "").trim();
      let pageContent = rawContent;
      if (rawContent.length > 0) {
        const split = splitSnapshotTextChunks(rawContent);
        stats.semanticChunksRaw += split.semanticChunks.length;
        const { bodyChunk: rawBody } = extractBodyChunk(split.nonSemanticChunks);
        if (rawBody) {
          stats.bodyBlocksRaw += 1;
        }
        const compacted = compactSnapshotText(
          rawContent,
          previousSemanticSignature,
          previousBodySignature,
        );
        pageContent = compacted.textContent;
        if (compacted.omittedSemanticChunks > 0) {
          stats.semanticChunksOmitted += compacted.omittedSemanticChunks;
          stats.snapshotsCompacted += 1;
        }
        if (compacted.omittedBodyBlocks > 0) {
          stats.bodyBlocksOmitted += compacted.omittedBodyBlocks;
          stats.snapshotsBodyCompacted += 1;
        }
        previousSemanticSignature = compacted.semanticSignature;
        previousBodySignature = compacted.bodySignature;
      } else {
        previousSemanticSignature = null;
        previousBodySignature = null;
      }

      lines.push(pageContent.length > 0 ? pageContent : "<empty>");
      if (page.htmlContent) {
        lines.push("htmlContent:");
        lines.push(page.htmlContent);
      }
      return lines.join("\n");
    })
    .join("\n\n");
  const content = `${headerLines.join("\n")}${bodyContent}`;
  return {
    content,
    stats,
  };
}

function hashForPath(value: string): string {
  let hash = 0;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash = (hash * 31 + value.charCodeAt(idx)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function buildSafeUrlBasenameMap(urls: string[]): Map<string, string> {
  const safeNames = new Map<string, string>();
  const usedNames = new Set<string>();
  const sortedUrls = [...urls].sort((a, b) => a.localeCompare(b));
  for (const url of sortedUrls) {
    const base = sanitizeZipPathPart(url);
    let candidate = base;
    if (usedNames.has(candidate)) {
      candidate = `${base}_${hashForPath(url)}`;
    }
    let suffix = 1;
    while (usedNames.has(candidate)) {
      candidate = `${base}_${hashForPath(url)}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(candidate);
    safeNames.set(url, candidate);
  }
  return safeNames;
}

function buildUrlTextEntriesWithCompaction(pages: EnrichedPageRecord[]): {
  entries: Array<{ filename: string; content: string }>;
  compaction: ExportCompactionStats;
} {
  const byPrefix = new Map<string, Map<string, EnrichedPageRecord[]>>();
  for (const page of pages) {
    const key = page.urlPrefix || "unknown";
    const byUrl = byPrefix.get(key) ?? new Map<string, EnrichedPageRecord[]>();
    const urlKey = page.url || "unknown";
    const urlRows = byUrl.get(urlKey) ?? [];
    urlRows.push(page);
    byUrl.set(urlKey, urlRows);
    byPrefix.set(key, byUrl);
  }
  const entries: Array<{ filename: string; content: string }> = [];
  const compaction: ExportCompactionStats = {
    semanticChunksRaw: 0,
    semanticChunksOmitted: 0,
    snapshotsCompacted: 0,
    bodyBlocksRaw: 0,
    bodyBlocksOmitted: 0,
    snapshotsBodyCompacted: 0,
  };
  const sortedPrefixes = [...byPrefix.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [prefix, byUrl] of sortedPrefixes) {
    const safePrefix = sanitizeZipPathPart(prefix);
    const urls = [...byUrl.keys()];
    const safeNames = buildSafeUrlBasenameMap(urls);
    const sortedUrls = [...urls].sort((a, b) => a.localeCompare(b));
    for (const url of sortedUrls) {
      const pageText = buildPrefixPageTextBlocks({ pages: byUrl.get(url) ?? [] });
      compaction.semanticChunksRaw += pageText.stats.semanticChunksRaw;
      compaction.semanticChunksOmitted += pageText.stats.semanticChunksOmitted;
      compaction.snapshotsCompacted += pageText.stats.snapshotsCompacted;
      compaction.bodyBlocksRaw += pageText.stats.bodyBlocksRaw;
      compaction.bodyBlocksOmitted += pageText.stats.bodyBlocksOmitted;
      compaction.snapshotsBodyCompacted += pageText.stats.snapshotsBodyCompacted;
      entries.push({
        filename: `pages/${safePrefix}/${safeNames.get(url)}.txt`,
        content: pageText.content,
      });
    }
  }
  return { entries, compaction };
}

function buildUrlTextEntries(
  pages: EnrichedPageRecord[],
): Array<{ filename: string; content: string }> {
  return buildUrlTextEntriesWithCompaction(pages).entries;
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
  return readPipelineStats(effectiveSizeBytes);
}

async function handleGetSessionStats(): Promise<SessionStats> {
  const stats = await handleGetPipelineStats();
  return {
    sessionId: recorderState.sessionId,
    pageCount: stats.totals.enrichedCount,
    droppedPageCount: recorderState.droppedPageCount,
    requestCount: 0,
    droppedRequestCount: recorderState.droppedRequestCount,
    urlCount: stats.urlRows.length,
    storageBytesInUse: stats.totals.totalBytes,
  };
}

async function handleGetHostQueueStats(): Promise<HostQueueStats> {
  const stats = await handleGetPipelineStats();
  const urls: HostQueueStatsRow[] = stats.urlRows.map((row) => ({
    url: row.url,
    mapped: true,
    queueSize: 0,
    workerActive: false,
  }));
  return {
    distinctUrlCount: urls.length,
    generatedAt: stats.generatedAt,
    urls,
  };
}

async function handleExportSession(): Promise<{
  sessionId: string;
  pageCount: number;
  requestCount: number;
  droppedPageCount: number;
  droppedRequestCount: number;
  urlCount: number;
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
    const { entries: urlEntries, compaction } = buildUrlTextEntriesWithCompaction(pages);
    const summary = buildSessionSummary(pages);
    const zipEntries = [...urlEntries];
    if (recorderSettings.saveExportMetadata) {
      const textEncoder = new TextEncoder();
      const uncompressedTextBytes = urlEntries.reduce(
        (sum, entry) => sum + textEncoder.encode(entry.content).length,
        0,
      );
      const zipPayloadBytes = createZip(urlEntries).byteLength;
      const exportMetrics = computeExportMetrics(
        compaction,
        uncompressedTextBytes,
        zipPayloadBytes,
      );
      const exportedAt = new Date().toISOString();
      const index = buildSessionIndex(summary, sessionId, exportedAt);
      const exportMetadata = buildExportMetadata({
        sessionId,
        exportedAt,
        pageCount: pages.length,
        summary,
        index,
        compaction,
        exportMetrics,
        settings: recorderSettings,
      });
      zipEntries.push({
        filename: "metadata.json",
        content: JSON.stringify(exportMetadata, null, 2),
      });
    }
    const zipBytes = createZip(zipEntries);
    await downloadZipFile(buildExportFilename(), zipBytes);
    return {
      sessionId,
      pageCount: pages.length,
      requestCount: 0,
      droppedPageCount: recorderState.droppedPageCount,
      droppedRequestCount: recorderState.droppedRequestCount,
      urlCount: summary.urlCount,
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
  const textContent = recorderSettings.savePageText
    ? truncateText(message.payload.textContent, PAGE_TEXT_LIMIT)
    : "";
  const htmlContent = recorderSettings.savePageHtml
    ? truncateText(message.payload.htmlContent ?? "", PAGE_HTML_LIMIT)
    : undefined;
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
    signatureHash: 0,
    contentSizeBytes: new Blob([textContent, htmlContent ?? ""]).size,
  };
  if (recorderState.storageBytesInUse + raw.contentSizeBytes > getIndexedDbHardLimitBytes()) {
    await updateState({
      ...recorderState,
      droppedPageCount: recorderState.droppedPageCount + 1,
    });
    return { ok: true, ignored: true };
  }
  const accepted = await enqueueRawSnapshot(raw);
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
  sanitizeZipPathPart,
  buildSessionSummary,
  buildSessionIndex,
  buildExportMetadata,
  computeExportMetrics,
  buildPrefixPageTextBlocks,
  buildUrlTextEntries,
  buildUrlTextEntriesWithCompaction,
  handleGetSessionStats,
  handleGetHostQueueStats,
  handleExportSession,
  handleClearSessionData,
};
