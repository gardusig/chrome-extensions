import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS, type RecorderState } from "../../src/lib/schema";
import { transformHtmlToIndentedText } from "../../src/lib/html-textify";
import { createChromeMock } from "../support/chrome-mocks";

type ChromeMockWithInternals = typeof chrome & {
  __runtimeListeners: Array<
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean | void
  >;
};

type SnapshotResponse = { ok: boolean; ignored?: boolean };
type StateResponse = { ok: boolean; state?: RecorderState; error?: string };

function decodeDataUrlBytes(dataUrl: string): Uint8Array {
  const match = dataUrl.match(/^data:application\/zip;base64,(.+)$/);
  if (!match) {
    throw new Error("Expected zip data URL");
  }
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function parseStoredZipEntries(bytes: Uint8Array): Map<string, string> {
  const textDecoder = new TextDecoder();
  const entries = new Map<string, string>();
  let offset = 0;
  const localHeaderSignature = 0x04034b50;

  while (offset + 30 <= bytes.length) {
    if (readU32LE(bytes, offset) !== localHeaderSignature) {
      break;
    }
    const compressionMethod = readU16LE(bytes, offset + 8);
    if (compressionMethod !== 0) {
      throw new Error(`Unsupported compression method in test parser: ${compressionMethod}`);
    }
    const fileNameLength = readU16LE(bytes, offset + 26);
    const extraLength = readU16LE(bytes, offset + 28);
    const compressedSize = readU32LE(bytes, offset + 18);

    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) {
      throw new Error("Invalid zip structure");
    }

    const fileName = textDecoder.decode(bytes.subarray(fileNameStart, fileNameEnd));
    const content = textDecoder.decode(bytes.subarray(dataStart, dataEnd));
    entries.set(fileName, content);

    offset = dataEnd;
  }

  return entries;
}

function findExportedPageContentByUrl(entries: Map<string, string>, url: string): string {
  const pageEntries = [...entries.entries()].filter(
    ([name]) => name.startsWith("pages/") && name.endsWith(".txt"),
  );
  const match = pageEntries.find(([, content]) => content.includes(`url: ${url}`));
  if (!match) {
    throw new Error(`No exported page file found for URL: ${url}`);
  }
  return match[1];
}

function expectHtmlProjection(pageContent: string, sourceHtml: string): void {
  const expectedProjection = transformHtmlToIndentedText(sourceHtml);
  expect(pageContent).toContain("htmlContent:");
  expect(pageContent).toContain(`htmlContent:\n${expectedProjection}`);
}

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

function withState(overrides: Partial<RecorderState> = {}): RecorderState {
  return { ...DEFAULT_STATE, ...overrides };
}

function withSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

async function loadBackground(
  seed: Record<string, unknown> = {},
): Promise<ChromeMockWithInternals> {
  const chromeMock = createChromeMock(seed) as ChromeMockWithInternals;
  globalThis.chrome = chromeMock;
  vi.resetModules();
  await import("../../src/background.ts");
  await Promise.resolve();
  await Promise.resolve();
  return chromeMock;
}

async function dispatchMessage(
  chromeMock: ChromeMockWithInternals,
  message: unknown,
  sender: chrome.runtime.MessageSender = {},
): Promise<unknown> {
  const listener = chromeMock.__runtimeListeners.at(-1);
  if (!listener) {
    throw new Error("runtime.onMessage listener not registered");
  }
  return new Promise((resolve) => {
    listener(message, sender, (response) => {
      resolve(response);
    });
  });
}

function tabSender(tabId: number, windowId = 1): chrome.runtime.MessageSender {
  return { tab: { id: tabId, windowId } as chrome.tabs.Tab };
}

async function sendSnapshot(
  chromeMock: ChromeMockWithInternals,
  payload: {
    url: string;
    title: string;
    textContent: string;
    reason: string;
    htmlContent?: string;
  },
  tabId = 1,
): Promise<SnapshotResponse> {
  return (await dispatchMessage(
    chromeMock,
    { type: "CONTENT_PAGE_SNAPSHOT", payload },
    tabSender(tabId),
  )) as SnapshotResponse;
}

async function startRecording(chromeMock: ChromeMockWithInternals): Promise<StateResponse> {
  return (await dispatchMessage(chromeMock, { type: "START_RECORDING" })) as StateResponse;
}

async function stopRecording(chromeMock: ChromeMockWithInternals): Promise<StateResponse> {
  return (await dispatchMessage(chromeMock, { type: "STOP_RECORDING" })) as StateResponse;
}

describe("background integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("handles stop while idle and ignores snapshots without a tab sender", async () => {
    const chromeMock = await loadBackground({
      [STORAGE_KEYS.state]: withState(),
      [STORAGE_KEYS.settings]: withSettings(),
    });
    vi.spyOn(chromeMock.tabs, "query").mockImplementation(async () => []);

    const stopWhileIdle = await stopRecording(chromeMock);
    expect(stopWhileIdle.ok).toBe(true);
    expect(stopWhileIdle.state).toMatchObject({
      isRecording: false,
      isStopping: false,
      stoppedAt: null,
    });

    await startRecording(chromeMock);
    const noTabSender = (await dispatchMessage(
      chromeMock,
      {
        type: "CONTENT_PAGE_SNAPSHOT",
        payload: {
          url: "https://example.com/no-tab",
          title: "No tab",
          textContent: "missing sender.tab.id",
          reason: "poll-diff",
        },
      },
      {},
    )) as SnapshotResponse;
    expect(noTabSender).toEqual({ ok: true, ignored: true });
  });

  it("captures snapshots into queue, drains on stop, and exports one zip", async () => {
    const chromeMock = await loadBackground({
      [STORAGE_KEYS.state]: withState(),
      [STORAGE_KEYS.settings]: withSettings({
        preset: "full_capture",
        hardLimitMb: 8,
        pollIntervalMs: 350,
        savePageHtml: true,
        saveExportMetadata: true,
      }),
    });

    const downloadSpy = vi.spyOn(chromeMock.downloads, "download");
    vi.spyOn(chromeMock.tabs, "query").mockImplementation(async () => []);

    const startResponse = await startRecording(chromeMock);
    expect(startResponse.ok).toBe(true);
    expect(startResponse.state?.isRecording).toBe(true);

    const captureResponse = await sendSnapshot(
      chromeMock,
      {
        url: "https://app.slack.com/client/T1",
        title: "Slack",
        textContent: "channel content",
        htmlContent: "<html><body><div>Slack<div>Inner</div>Tail</div></body></html>",
        reason: "test",
      },
      11,
    );
    expect(captureResponse.ok).toBe(true);
    expect(captureResponse.ignored).not.toBe(true);

    await stopRecording(chromeMock);
    const statsResponse = (await dispatchMessage(chromeMock, {
      type: "GET_PIPELINE_STATS",
    })) as { ok: boolean; stats?: { totals: { enrichedCount: number } } };
    expect(statsResponse.ok).toBe(true);
    expect(statsResponse.stats?.totals.enrichedCount).toBeGreaterThanOrEqual(1);

    const exportResponse = (await dispatchMessage(chromeMock, {
      type: "EXPORT_SESSION",
    })) as { ok: boolean; pageCount?: number };
    expect(exportResponse.ok).toBe(true);
    expect(exportResponse.pageCount).toBeGreaterThanOrEqual(1);
    expect(downloadSpy).toHaveBeenCalledTimes(1);

    const downloadArgs = downloadSpy.mock.calls[0]?.[0];
    expect(downloadArgs).toMatchObject({
      filename: expect.stringMatching(/^recordings\/.+\.zip$/),
      saveAs: false,
      conflictAction: "overwrite",
    });
    expect(typeof downloadArgs.url).toBe("string");

    const zipBytes = decodeDataUrlBytes(downloadArgs.url);
    const entries = parseStoredZipEntries(zipBytes);
    expect(entries.has("metadata.json")).toBe(true);
    const pageEntryName = [...entries.keys()].find(
      (name) => name.startsWith("pages/") && name.endsWith(".txt"),
    );
    expect(pageEntryName).toBeDefined();
    const pageEntry = entries.get(pageEntryName!);
    expect(pageEntry).toBeDefined();
    if (!pageEntry) {
      throw new Error("Expected exported page entry content");
    }
    expect(pageEntry).toContain("---");
    expect(pageEntry).toContain("# Page Index");
    expect(pageEntry).toContain("url: https://app.slack.com/client/T1");
    expect(pageEntry).toContain("snapshotCount: 1");
    expect(pageEntry).toContain("content:");
    expectHtmlProjection(
      pageEntry,
      "<html><body><div>Slack<div>Inner</div>Tail</div></body></html>",
    );
    expect(pageEntry).not.toContain("reason:");
    expect(pageEntry).not.toContain("timestamp:");
    expect(pageEntry).not.toContain("tabId:");
    expect(pageEntry).not.toContain("windowId:");

    const metadataRaw = entries.get("metadata.json");
    expect(metadataRaw).toBeDefined();
    const metadata = JSON.parse(metadataRaw!);
    expect(metadata).toMatchObject({
      pageCount: 1,
      urlCount: 1,
      summary: {
        websitesOpened: 1,
        urlsCaptured: 1,
        snapshotCount: 1,
      },
      settings: expect.objectContaining({
        preset: "full_capture",
        savePageHtml: true,
      }),
      index: expect.objectContaining({
        websitesOpened: 1,
        urlsCaptured: 1,
      }),
    });
    expect(metadata.indexText).toBeUndefined();
  });

  it("compacts repeated semantic chunks in exported page text", async () => {
    const chromeMock = await loadBackground({
      [STORAGE_KEYS.state]: withState(),
      [STORAGE_KEYS.settings]: withSettings({ saveExportMetadata: true }),
    });
    const downloadSpy = vi.spyOn(chromeMock.downloads, "download");
    vi.spyOn(chromeMock.tabs, "query").mockImplementation(async () => []);

    await startRecording(chromeMock);
    await sendSnapshot(
      chromeMock,
      {
        url: "https://example.com/dashboard",
        title: "Dashboard",
        reason: "pagehide",
        textContent: [
          "[source=body selector=body]",
          "Main content 1",
          "",
          "[source=semantic selector=button kind=aria-label]",
          "Save changes",
        ].join("\n"),
      },
      17,
    );
    await sendSnapshot(
      chromeMock,
      {
        url: "https://example.com/dashboard",
        title: "Dashboard",
        reason: "pagehide",
        textContent: [
          "[source=body selector=body]",
          "Main content 2",
          "",
          "[source=semantic selector=button kind=aria-label]",
          "Save changes",
        ].join("\n"),
      },
      17,
    );
    await stopRecording(chromeMock);

    const exportResponse = (await dispatchMessage(chromeMock, {
      type: "EXPORT_SESSION",
    })) as { ok: boolean };
    expect(exportResponse.ok).toBe(true);
    expect(downloadSpy).toHaveBeenCalledTimes(1);

    const downloadArgs = downloadSpy.mock.calls[0]?.[0];
    const zipBytes = decodeDataUrlBytes(downloadArgs.url);
    const entries = parseStoredZipEntries(zipBytes);
    const pageEntryName = [...entries.keys()].find(
      (name) => name.startsWith("pages/") && name.endsWith(".txt"),
    );
    expect(pageEntryName).toBeDefined();
    const pageEntry = entries.get(pageEntryName!);
    expect(pageEntry).toContain("Main content 1");
    expect(pageEntry).toContain("Main content 2");
    expect(pageEntry).toContain("<unchanged-from-previous-snapshot>");

    const metadata = JSON.parse(entries.get("metadata.json") ?? "{}");
    expect(metadata.compaction).toMatchObject({
      semanticChunksRaw: 2,
      semanticChunksOmitted: 1,
      snapshotsCompacted: 1,
    });
  });

  it("exports realistic slack, github, and jira page examples", async () => {
    const chromeMock = await loadBackground({
      [STORAGE_KEYS.state]: withState(),
      [STORAGE_KEYS.settings]: withSettings({
        preset: "full_capture",
        savePageHtml: true,
        saveExportMetadata: false,
      }),
    });
    const downloadSpy = vi.spyOn(chromeMock.downloads, "download");
    vi.spyOn(chromeMock.tabs, "query").mockImplementation(async () => []);

    await startRecording(chromeMock);

    const snapshots = [
      {
        url: "https://app.slack.com/client/T123/C456",
        title: "engineering (Channel) - Slack",
        textContent: "Slack channel timeline example",
        htmlContent: "<html><body><div>Channel<div>Message list</div></div></body></html>",
        reason: "poll-diff",
        tabId: 101,
      },
      {
        url: "https://app.slack.com/client/T123/D789",
        title: "Alex (Direct message) - Slack",
        textContent: "Slack direct message example",
        htmlContent: "<html><body><div>DM<div>Conversation pane</div></div></body></html>",
        reason: "poll-diff",
        tabId: 102,
      },
      {
        url: "https://app.slack.com/client/T123/C456/thread/C456-1711111111.000200",
        title: "Thread reply - Slack",
        textContent: "Slack thread example",
        htmlContent: "<html><body><div>Thread<div>Replies</div></div></body></html>",
        reason: "pagehide",
        tabId: 103,
      },
      {
        url: "https://github.com/org/repo/pull/123#issuecomment-987654321",
        title: "PR comments · org/repo",
        textContent: "GitHub PR comment timeline",
        htmlContent: "<html><body><div>PR comments<div>Review note</div></div></body></html>",
        reason: "poll-diff",
        tabId: 201,
      },
      {
        url: "https://github.com/org/repo/pull/123/checks",
        title: "Checks · org/repo",
        textContent: "GitHub checks statuses",
        htmlContent: "<html><body><div>Checks<div>CI matrix</div></div></body></html>",
        reason: "manual-capture",
        tabId: 202,
      },
      {
        url: "https://jira.example.com/browse/ENG-42",
        title: "ENG-42 Story",
        textContent: "Jira issue details and comments",
        htmlContent: "<html><body><div>Issue<div>Description</div></div></body></html>",
        reason: "recording-start-initial-scan",
        tabId: 301,
      },
    ] as const;

    for (const snapshot of snapshots) {
      const response = await sendSnapshot(
        chromeMock,
        {
          url: snapshot.url,
          title: snapshot.title,
          textContent: snapshot.textContent,
          htmlContent: snapshot.htmlContent,
          reason: snapshot.reason,
        },
        snapshot.tabId,
      );
      expect(response.ok).toBe(true);
      expect(response.ignored).not.toBe(true);
    }

    await stopRecording(chromeMock);
    const exportResponse = (await dispatchMessage(chromeMock, {
      type: "EXPORT_SESSION",
    })) as { ok: boolean; pageCount?: number };
    expect(exportResponse.ok).toBe(true);
    expect(exportResponse.pageCount).toBe(snapshots.length);

    const downloadArgs = downloadSpy.mock.calls[0]?.[0];
    const zipBytes = decodeDataUrlBytes(downloadArgs.url);
    const entries = parseStoredZipEntries(zipBytes);
    expect(entries.has("metadata.json")).toBe(false);

    const pageEntries = [...entries.entries()].filter(
      ([name]) => name.startsWith("pages/") && name.endsWith(".txt"),
    );
    expect(pageEntries).toHaveLength(snapshots.length);

    for (const snapshot of snapshots) {
      const pageContent = findExportedPageContentByUrl(entries, snapshot.url);
      expect(pageContent).toContain(snapshot.textContent);
      expectHtmlProjection(pageContent, snapshot.htmlContent);
    }
  });

  it("validates html-to-exported-file content transformation through mocked browser pipeline", async () => {
    const chromeMock = await loadBackground({
      [STORAGE_KEYS.state]: withState(),
      [STORAGE_KEYS.settings]: withSettings({
        preset: "full_capture",
        savePageHtml: true,
        saveExportMetadata: false,
      }),
    });
    const downloadSpy = vi.spyOn(chromeMock.downloads, "download");
    vi.spyOn(chromeMock.tabs, "query").mockImplementation(async () => []);

    await startRecording(chromeMock);
    const response = await sendSnapshot(
      chromeMock,
      {
        url: "https://app.slack.com/client/T999/C777",
        title: "engine-room (Channel) - Slack",
        reason: "poll-diff",
        textContent: "Plain text body from capture",
        htmlContent: [
          "<html><head><style>.hidden{display:none}</style></head>",
          "<body>",
          "<div>Channel header</div>",
          "<div>Thread root <span>reply one</span></div>",
          "<div>&amp; escaped and <strong>bold text</strong></div>",
          "<script>console.log('should not leak')</script>",
          "</body></html>",
        ].join(""),
      },
      909,
    );
    expect(response.ok).toBe(true);
    expect(response.ignored).not.toBe(true);

    await stopRecording(chromeMock);
    const exportResponse = (await dispatchMessage(chromeMock, {
      type: "EXPORT_SESSION",
    })) as { ok: boolean; pageCount?: number };
    expect(exportResponse.ok).toBe(true);
    expect(exportResponse.pageCount).toBe(1);

    const downloadArgs = downloadSpy.mock.calls[0]?.[0];
    const zipBytes = decodeDataUrlBytes(downloadArgs.url);
    const entries = parseStoredZipEntries(zipBytes);
    const pageContent = findExportedPageContentByUrl(
      entries,
      "https://app.slack.com/client/T999/C777",
    );

    // File-level index remains at top of each exported page file.
    expect(pageContent).toContain("# Page Index");
    expect(pageContent).toContain("url: https://app.slack.com/client/T999/C777");

    // Captured text block remains present.
    expect(pageContent).toContain("content:\nPlain text body from capture");

    // HTML is transformed to plain text lines in export.
    expectHtmlProjection(
      pageContent,
      [
        "<html><head><style>.hidden{display:none}</style></head>",
        "<body>",
        "<div>Channel header</div>",
        "<div>Thread root <span>reply one</span></div>",
        "<div>&amp; escaped and <strong>bold text</strong></div>",
        "<script>console.log('should not leak')</script>",
        "</body></html>",
      ].join(""),
    );

    // Script/style internals and raw tags should not leak.
    expect(pageContent).not.toContain("console.log('should not leak')");
    expect(pageContent).not.toContain(".hidden{display:none}");
    expect(pageContent).not.toContain("<div>");
    expect(pageContent).not.toContain("<strong>");
  });

  it("covers snapshot ignore branches and runtime message matrix", async () => {
    const chromeMock = await loadBackground({
      [STORAGE_KEYS.state]: withState(),
      [STORAGE_KEYS.settings]: withSettings(),
    });
    vi.spyOn(chromeMock.tabs, "query").mockImplementation(async () => []);

    // 1) Snapshot ignored before recording starts.
    const ignoredBeforeStart = await sendSnapshot(chromeMock, {
      url: "https://example.com/a",
      title: "A",
      textContent: "a",
      reason: "poll-diff",
    });
    expect(ignoredBeforeStart).toEqual({ ok: true, ignored: true });

    await startRecording(chromeMock);

    // 2) Empty snapshot ignored.
    const emptyPayload = await sendSnapshot(chromeMock, {
      url: "https://example.com/empty",
      title: "Empty",
      textContent: "",
      reason: "poll-diff",
    });
    expect(emptyPayload).toEqual({ ok: true, ignored: true });

    // 3) First non-poll capture accepted.
    const first = await sendSnapshot(chromeMock, {
      url: "https://example.com/a",
      title: "A",
      textContent: "first",
      reason: "pagehide",
    });
    expect(first.ok).toBe(true);
    expect(first.ignored).not.toBe(true);

    // 4) Duplicate is now accepted into raw+queue and deduped in consumer.
    const duplicate = await sendSnapshot(chromeMock, {
      url: "https://example.com/a",
      title: "A",
      textContent: "first",
      reason: "pagehide",
    });
    expect(duplicate).toEqual({ ok: true, ignored: false });

    // 5) Poll-diff is also accepted and evaluated in queue consumer stage.
    const throttled = await sendSnapshot(chromeMock, {
      url: "https://example.com/a",
      title: "A",
      textContent: "second",
      reason: "poll-diff",
    });
    expect(throttled).toEqual({ ok: true, ignored: false });

    await stopRecording(chromeMock);
    const pipelineAfterDrain = (await dispatchMessage(chromeMock, {
      type: "GET_PIPELINE_STATS",
    })) as { ok: boolean; stats?: { totals: { enrichedCount: number } } };
    expect(pipelineAfterDrain.ok).toBe(true);
    expect(pipelineAfterDrain.stats?.totals.enrichedCount).toBe(2);

    await expect(dispatchMessage(chromeMock, { type: "GET_STATE" })).resolves.toMatchObject({
      ok: true,
    });
    await expect(dispatchMessage(chromeMock, { type: "GET_SETTINGS" })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      dispatchMessage(chromeMock, { type: "UPDATE_SETTINGS", payload: { savePageHtml: true } }),
    ).resolves.toMatchObject({ ok: true });
    await expect(dispatchMessage(chromeMock, { type: "GET_SESSION_STATS" })).resolves.toMatchObject(
      {
        ok: true,
      },
    );
    await expect(
      dispatchMessage(chromeMock, { type: "GET_HOST_QUEUE_STATS" }),
    ).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      dispatchMessage(chromeMock, { type: "CLEAR_SESSION_DATA" }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("accepts large snapshots and updates state stats", async () => {
    const chromeMock = await loadBackground({
      [STORAGE_KEYS.state]: withState({ storageBytesInUse: 34 * 1024 * 1024 }),
      [STORAGE_KEYS.settings]: withSettings({ hardLimitMb: 128 }),
    });
    vi.spyOn(chromeMock.tabs, "query").mockImplementation(async () => []);
    await startRecording(chromeMock);
    const hugePayload = "x".repeat(33 * 1024 * 1024);

    const accepted = await sendSnapshot(
      chromeMock,
      {
        url: "https://example.com/limit",
        title: "Limit",
        textContent: hugePayload,
        reason: "pagehide",
      },
      7,
    );
    expect(accepted).toEqual({ ok: true, ignored: false });

    const stateResponse = (await dispatchMessage(chromeMock, {
      type: "GET_STATE",
    })) as StateResponse;
    expect(stateResponse.state?.droppedPageCount).toBe(0);
  });

  it("returns export errors for active recording and concurrent exports", async () => {
    const chromeMock = await loadBackground({
      [STORAGE_KEYS.settings]: withSettings(),
    });
    vi.spyOn(chromeMock.tabs, "query").mockImplementation(async () => []);

    let releaseDownload: (() => void) | undefined;
    vi.spyOn(chromeMock.downloads, "download").mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          releaseDownload = () => resolve(1);
        }),
    );

    await startRecording(chromeMock);
    const blockedByRecording = (await dispatchMessage(chromeMock, {
      type: "EXPORT_SESSION",
    })) as { ok: boolean; error?: string };
    expect(blockedByRecording.ok).toBe(false);
    expect(blockedByRecording.error).toContain("Stop recording before exporting");

    await sendSnapshot(
      chromeMock,
      {
        url: "https://example.com/page",
        title: "Page",
        textContent: "content",
        reason: "pagehide",
      },
      5,
    );
    await stopRecording(chromeMock);

    const firstExport = dispatchMessage(chromeMock, { type: "EXPORT_SESSION" });
    const secondExport = dispatchMessage(chromeMock, { type: "EXPORT_SESSION" });
    const secondResult = (await secondExport) as { ok: boolean; error?: string };
    expect(secondResult.ok).toBe(false);
    expect(secondResult.error).toContain("Export already in progress");

    if (releaseDownload) {
      releaseDownload();
    }
    await firstExport;
  });
});
