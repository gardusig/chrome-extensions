import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS, type RecorderState } from "../../src/lib/schema";
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
    savePageText: true,
    savePageHtml: false,
    saveRequestData: false,
    savePageMeta: true,
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
        htmlContent: "<html><body>Slack</body></html>",
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

    // 4) Duplicate ignored.
    const duplicate = await sendSnapshot(chromeMock, {
      url: "https://example.com/a",
      title: "A",
      textContent: "first",
      reason: "pagehide",
    });
    expect(duplicate).toEqual({ ok: true, ignored: true });

    // 5) Poll-diff within throttle window ignored.
    const throttled = await sendSnapshot(chromeMock, {
      url: "https://example.com/a",
      title: "A",
      textContent: "second",
      reason: "poll-diff",
    });
    expect(throttled).toEqual({ ok: true, ignored: true });

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
      [STORAGE_KEYS.settings]: withSettings(),
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
