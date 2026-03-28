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

describe("background integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("captures snapshots into queue, drains on stop, and exports one zip", async () => {
    const chromeMock = await loadBackground({
      [STORAGE_KEYS.state]: {
        isRecording: false,
        isStopping: false,
        sessionId: null,
        startedAt: null,
        stoppedAt: null,
        droppedPageCount: 0,
        droppedRequestCount: 0,
        storageBytesInUse: 0,
      } satisfies RecorderState,
      [STORAGE_KEYS.settings]: {
        preset: "full_capture",
        hardLimitMb: 8,
        autoExportOnSoftLimit: false,
        pollIntervalMs: 350,
        forceInitialScanOnStart: false,
        savePageText: true,
        savePageHtml: true,
        saveRequestData: false,
        savePageMeta: true,
      },
    });

    const downloadSpy = vi.spyOn(chromeMock.downloads, "download");
    vi.spyOn(chromeMock.tabs, "query").mockResolvedValue([]);

    const startResponse = (await dispatchMessage(chromeMock, {
      type: "START_RECORDING",
    })) as { ok: boolean; state?: RecorderState };
    expect(startResponse.ok).toBe(true);
    expect(startResponse.state?.isRecording).toBe(true);

    const captureResponse = (await dispatchMessage(
      chromeMock,
      {
        type: "CONTENT_PAGE_SNAPSHOT",
        payload: {
          url: "https://app.slack.com/client/T1",
          title: "Slack",
          textContent: "channel content",
          htmlContent: "<html><body>Slack</body></html>",
          reason: "test",
        },
      },
      { tab: { id: 11, windowId: 1 } as chrome.tabs.Tab },
    )) as { ok: boolean; ignored?: boolean };
    expect(captureResponse.ok).toBe(true);
    expect(captureResponse.ignored).not.toBe(true);

    await dispatchMessage(chromeMock, { type: "STOP_RECORDING" });
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
});
