import type { PageSnapshotRecord, RecorderSettings, RequestRecord } from "./schema";
import { formatSections, sanitizeSections } from "./section-parsers/format";
import { parseSections } from "./section-parsers/registry";
import type { ParsedSection } from "./section-parsers/types";

export type SessionExportResult = {
  sessionId: string;
  pageCount: number;
  requestCount: number;
  droppedPageCount: number;
  droppedRequestCount: number;
  hostCount: number;
};

type ExportSessionRecordsInput = {
  sessionId: string;
  metadata: { startedAt: string | null; stoppedAt: string | null };
  pages: PageSnapshotRecord[];
  requests: RequestRecord[];
  recorderSettings: RecorderSettings;
  droppedPageCount: number;
  droppedRequestCount: number;
  storageBytesInUse: number;
  storageLimits: {
    softLimitBytes: number;
    hardLimitBytes: number;
    trimTargetBytes: number;
  };
  downloadTextFile: (filename: string, content: string) => Promise<void>;
  now?: () => string;
};

type PageSnapshotJsonlRecord = {
  sessionId: string;
  timestamp: string;
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  reason: string;
  sections: ParsedSection[];
  text?: string;
  html?: string;
};

export function sanitizePathPart(value: string): string {
  return value.replaceAll(/[^\w.-]/g, "_");
}

function parseRecordTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return parsed;
}

function buildSectionsSafe(pageRecord: PageSnapshotRecord): ParsedSection[] {
  try {
    return sanitizeSections(
      parseSections({
        url: pageRecord.url,
        textContent: pageRecord.textContent,
        htmlContent: pageRecord.htmlContent,
      }),
    );
  } catch {
    return [];
  }
}

export async function exportSessionRecords({
  sessionId,
  metadata,
  pages,
  requests,
  recorderSettings,
  droppedPageCount,
  droppedRequestCount,
  storageBytesInUse,
  storageLimits,
  downloadTextFile,
  now = () => new Date().toISOString(),
}: ExportSessionRecordsInput): Promise<SessionExportResult> {
  const safeSessionId = sanitizePathPart(sessionId);
  const groupedByHost = new Map<string, PageSnapshotRecord[]>();

  for (const pageRecord of pages) {
    let hostKey = "unknown";
    try {
      // c8 ignore next -- URL.host is always non-empty for valid absolute URLs.
      hostKey = new URL(pageRecord.url).host || "unknown";
    } catch {
      // Keep default.
    }
    const currentGroup = groupedByHost.get(hostKey) ?? [];
    currentGroup.push(pageRecord);
    groupedByHost.set(hostKey, currentGroup);
  }

  for (const [hostKey, groupRecords] of groupedByHost.entries()) {
    const safeHost = sanitizePathPart(hostKey);
    const textFilename = `recordings/${safeSessionId}/pages/${safeHost}.txt`;
    const jsonlFilename = `recordings/${safeSessionId}/pages/${safeHost}.jsonl`;
    const sorted = [...groupRecords].sort(
      (a, b) => parseRecordTimestamp(a.timestamp) - parseRecordTimestamp(b.timestamp),
    );
    const textChunks: string[] = [];
    const jsonlChunks: string[] = [];
    textChunks.push(`# Host: ${hostKey}`);
    textChunks.push(`snapshotCount: ${sorted.length}`);
    textChunks.push("");

    for (const pageRecord of sorted) {
      textChunks.push("--- snapshot ---");
      textChunks.push(`timestamp: ${pageRecord.timestamp}`);
      if (recorderSettings.savePageMeta) {
        textChunks.push(`title: ${pageRecord.title}`);
        textChunks.push(`url: ${pageRecord.url}`);
        textChunks.push(`tabId: ${pageRecord.tabId}`);
        textChunks.push(`windowId: ${pageRecord.windowId}`);
        textChunks.push(`reason: ${pageRecord.reason}`);
      }
      textChunks.push("");
      const sections = buildSectionsSafe(pageRecord);
      const formattedSections = formatSections(sections);
      if (formattedSections) {
        textChunks.push("sections:");
        textChunks.push(formattedSections);
        textChunks.push("");
      }
      if (pageRecord.textContent) {
        textChunks.push("text:");
        textChunks.push(pageRecord.textContent);
        textChunks.push("");
      }
      if (pageRecord.htmlContent) {
        textChunks.push("html:");
        textChunks.push(pageRecord.htmlContent);
      }
      textChunks.push("");

      const jsonlRecord: PageSnapshotJsonlRecord = {
        sessionId: pageRecord.sessionId,
        timestamp: pageRecord.timestamp,
        tabId: pageRecord.tabId,
        windowId: pageRecord.windowId,
        url: pageRecord.url,
        title: pageRecord.title,
        reason: pageRecord.reason,
        sections,
      };
      if (pageRecord.textContent) {
        jsonlRecord.text = pageRecord.textContent;
      }
      if (pageRecord.htmlContent) {
        jsonlRecord.html = pageRecord.htmlContent;
      }
      jsonlChunks.push(JSON.stringify(jsonlRecord));
    }

    await downloadTextFile(textFilename, textChunks.join("\n"));
    await downloadTextFile(jsonlFilename, jsonlChunks.join("\n"));
  }

  if (requests.length > 0) {
    const groupedRequestsByHost = new Map<string, RequestRecord[]>();
    for (const requestRecord of requests) {
      let hostKey = "unknown";
      try {
        // c8 ignore next -- URL.host is always non-empty for valid absolute URLs.
        hostKey = new URL(requestRecord.url).host || "unknown";
      } catch {
        // Keep default.
      }
      const group = groupedRequestsByHost.get(hostKey) ?? [];
      group.push(requestRecord);
      groupedRequestsByHost.set(hostKey, group);
    }

    for (const [hostKey, groupRecords] of groupedRequestsByHost.entries()) {
      const safeHost = sanitizePathPart(hostKey);
      const filename = `recordings/${safeSessionId}/requests/${safeHost}.txt`;
      const sorted = [...groupRecords].sort(
        (a, b) => parseRecordTimestamp(a.timestamp) - parseRecordTimestamp(b.timestamp),
      );
      const chunks: string[] = [];
      chunks.push(`# Host: ${hostKey}`);
      chunks.push(`requestCount: ${sorted.length}`);
      chunks.push("");

      for (const requestRecord of sorted) {
        chunks.push("--- request ---");
        chunks.push(`timestamp: ${requestRecord.timestamp}`);
        chunks.push(`method: ${requestRecord.method}`);
        chunks.push(`type: ${requestRecord.type}`);
        chunks.push(`url: ${requestRecord.url}`);
        chunks.push(`tabId: ${requestRecord.tabId}`);
        chunks.push(`windowId: ${requestRecord.windowId}`);
        if (requestRecord.initiator) {
          chunks.push(`initiator: ${requestRecord.initiator}`);
        }
        chunks.push("");
      }

      await downloadTextFile(filename, chunks.join("\n"));
    }
  }

  const metaFilename = `recordings/${safeSessionId}/session-metadata.json`;
  await downloadTextFile(
    metaFilename,
    JSON.stringify(
      {
        sessionId,
        startedAt: metadata.startedAt,
        stoppedAt: metadata.stoppedAt,
        exportedAt: now(),
        pageCount: pages.length,
        droppedPageCount,
        requestCount: requests.length,
        droppedRequestCount,
        hostCount: groupedByHost.size,
        storageBytesInUse,
        captureSettings: recorderSettings,
        storageLimits,
      },
      null,
      2,
    ),
  );

  return {
    sessionId,
    pageCount: pages.length,
    requestCount: requests.length,
    droppedPageCount,
    droppedRequestCount,
    hostCount: groupedByHost.size,
  };
}
