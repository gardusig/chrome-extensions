import { describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../src/lib/schema";
import { createChromeMock } from "../support/chrome-mocks";

type BackgroundModule = typeof import("../../src/background");
type ChromeMockWithInternals = typeof chrome & {
  __runtimeListeners: Array<
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean | void
  >;
  __tabRemovedListeners: Array<(tabId: number) => void>;
  __startupListeners: Array<() => void>;
  __installedListeners: Array<() => void>;
  __beforeRequestListeners: Array<
    (details: chrome.webRequest.OnBeforeRequestDetails) => chrome.webRequest.BlockingResponse | void
  >;
};

async function loadBackgroundWithHooks(seed: Record<string, unknown> = {}): Promise<{
  module: BackgroundModule;
  chromeMock: ChromeMockWithInternals;
}> {
  const chromeMock = createChromeMock(seed) as ChromeMockWithInternals;
  globalThis.chrome = chromeMock;
  vi.resetModules();
  const module = await import("../../src/background");
  return { module, chromeMock };
}

describe("background test hooks", () => {
  it("covers core utility hooks", async () => {
    const { module } = await loadBackgroundWithHooks({
      [STORAGE_KEYS.pages]: "not-array",
      [STORAGE_KEYS.requests]: [],
    });
    const hooks = module.__testHooks;

    expect(hooks.parseRecordTimestamp("invalid")).toBe(Number.MAX_SAFE_INTEGER);
    expect(hooks.parseRecordTimestamp("2026-03-28T00:00:00.000Z")).toBeGreaterThan(0);
    expect(hooks.isCapturableUrl(undefined)).toBe(false);
    expect(hooks.isCapturableUrl("chrome://extensions")).toBe(false);
    expect(hooks.isCapturableUrl("https://github.com")).toBe(true);

    hooks.resetSnapshotStateForSession();
    const hashOne = hooks.snapshotSignatureHash({
      url: "https://github.com",
      title: "GitHub",
      textContent: "hello world",
    });
    const hashTwo = hooks.snapshotSignatureHash({
      url: "https://github.com",
      title: "GitHub",
      textContent: "hello world updated",
    });
    expect(hooks.shouldAppendSnapshot(1, hashOne, 1_000, "poll-diff")).toBe(true);
    expect(hooks.shouldAppendSnapshot(1, hashOne, 1_050, "poll-diff")).toBe(false);
    expect(hooks.shouldAppendSnapshot(1, hashTwo, 1_400, "poll-diff")).toBe(true);
    await expect(hooks.getRecords(STORAGE_KEYS.pages)).resolves.toEqual([]);
    await expect(hooks.getRecords(STORAGE_KEYS.requests)).resolves.toEqual([]);
  });

  it("handles runtime unhandled and thrown-message responses", async () => {
    const { chromeMock } = await loadBackgroundWithHooks();
    const listener = chromeMock.__runtimeListeners.at(-1);
    expect(listener).toBeDefined();

    let shouldKeepChannelOpen: boolean | void = false;
    const unhandledResponse = await new Promise<unknown>((resolve) => {
      shouldKeepChannelOpen = listener!({ type: "UNKNOWN_MESSAGE" }, {}, (response) =>
        resolve(response),
      );
    });
    expect(shouldKeepChannelOpen).toBe(true);
    expect(unhandledResponse).toEqual({
      ok: false,
      error: "Unhandled message type.",
    });

    const exportError = await new Promise<unknown>((resolve) => {
      listener!({ type: "EXPORT_SESSION" }, {}, (response) => resolve(response));
    });
    expect(exportError).toEqual({ ok: false, error: "No captured pages available to export." });
  });

  it("accepts tab removed callback invocation", async () => {
    const { chromeMock } = await loadBackgroundWithHooks();
    expect(() =>
      chromeMock.__tabRemovedListeners.forEach((callback) => callback(101)),
    ).not.toThrow();
  });

  it("invokes startup/install and webRequest listeners", async () => {
    const { chromeMock } = await loadBackgroundWithHooks();
    expect(() => chromeMock.__installedListeners.forEach((listener) => listener())).not.toThrow();
    expect(() => chromeMock.__startupListeners.forEach((listener) => listener())).not.toThrow();
    expect(() =>
      chromeMock.__beforeRequestListeners.forEach((listener) =>
        listener({
          method: "GET",
          requestId: "1",
          tabId: 1,
          timeStamp: Date.now(),
          type: "xmlhttprequest",
          url: "https://example.com",
          frameId: 0,
          parentFrameId: -1,
        }),
      ),
    ).not.toThrow();
  });

  it("returns default session and host queue stats", async () => {
    const { module } = await loadBackgroundWithHooks();
    const hooks = module.__testHooks;

    await expect(hooks.handleGetSessionStats()).resolves.toMatchObject({
      sessionId: null,
      pageCount: 0,
      droppedPageCount: 0,
      requestCount: 0,
      droppedRequestCount: 0,
      urlCount: 0,
    });
    await expect(hooks.handleGetHostQueueStats()).resolves.toMatchObject({
      distinctUrlCount: 0,
      urls: [],
    });
  });

  it("builds per-url text exports nested under prefix folders", async () => {
    const { module } = await loadBackgroundWithHooks();
    const hooks = module.__testHooks;

    const entries = hooks.buildUrlTextEntries([
      {
        id: "2",
        createdAt: "2026-03-28T10:00:03.000Z",
        tabId: 2,
        windowId: 1,
        url: "https://github.com/org/repo/pulls",
        urlPrefix: "github.com",
        title: "Pulls",
        reason: "poll-diff",
        timestamp: "2026-03-28T10:00:03.000Z",
        textContent: "second",
        sectionCount: 1,
        contentSizeBytes: 10,
      },
      {
        id: "1",
        createdAt: "2026-03-28T10:00:01.000Z",
        tabId: 2,
        windowId: 1,
        url: "https://github.com/org/repo",
        urlPrefix: "github.com",
        title: "Repo",
        reason: "poll-diff",
        timestamp: "2026-03-28T10:00:01.000Z",
        textContent: "first",
        sectionCount: 1,
        contentSizeBytes: 10,
      },
      {
        id: "3",
        createdAt: "2026-03-28T10:00:02.000Z",
        tabId: 3,
        windowId: 1,
        url: "https://jira.example.com/browse/ENG-42",
        urlPrefix: "jira.example.com",
        title: "ENG-42",
        reason: "poll-diff",
        timestamp: "2026-03-28T10:00:02.000Z",
        textContent: "jira",
        sectionCount: 1,
        contentSizeBytes: 10,
      },
    ]);

    expect(entries.map((entry) => entry.filename)).toEqual([
      "pages/github.com/https___github.com_org_repo.txt",
      "pages/github.com/https___github.com_org_repo_pulls.txt",
      "pages/jira.example.com/https___jira.example.com_browse_ENG-42.txt",
    ]);
    expect(entries[0].content).toContain("timestamp: 2026-03-28T10:00:01.000Z");
    expect(entries[0].content).toContain("content:\nfirst");
    expect(entries[1].content).toContain("url: https://github.com/org/repo/pulls");
    expect(entries[2].content).toContain("url: https://jira.example.com/browse/ENG-42");
  });

  it("builds session index summary with host/page durations", async () => {
    const { module } = await loadBackgroundWithHooks();
    const hooks = module.__testHooks;

    const summary = hooks.buildSessionSummary([
      {
        id: "1",
        createdAt: "2026-03-28T10:00:00.000Z",
        tabId: 1,
        windowId: 1,
        url: "https://github.com/org/repo",
        urlPrefix: "github.com",
        title: "Repo",
        reason: "poll-diff",
        timestamp: "2026-03-28T10:00:00.000Z",
        textContent: "a",
        sectionCount: 1,
        contentSizeBytes: 1,
      },
      {
        id: "2",
        createdAt: "2026-03-28T10:00:08.000Z",
        tabId: 1,
        windowId: 1,
        url: "https://github.com/org/repo",
        urlPrefix: "github.com",
        title: "Repo",
        reason: "poll-diff",
        timestamp: "2026-03-28T10:00:08.000Z",
        textContent: "b",
        sectionCount: 1,
        contentSizeBytes: 1,
      },
      {
        id: "3",
        createdAt: "2026-03-28T10:00:02.000Z",
        tabId: 2,
        windowId: 1,
        url: "https://jira.example.com/browse/ENG-42",
        urlPrefix: "jira.example.com",
        title: "ENG-42",
        reason: "poll-diff",
        timestamp: "2026-03-28T10:00:02.000Z",
        textContent: "c",
        sectionCount: 1,
        contentSizeBytes: 1,
      },
    ]);

    expect(summary.websiteCount).toBe(2);
    expect(summary.snapshotCount).toBe(3);
    expect(summary.startedAt).toBe("2026-03-28T10:00:00.000Z");
    expect(summary.endedAt).toBe("2026-03-28T10:00:08.000Z");
    expect(summary.durationSeconds).toBe(8);
    const github = summary.websites.find(
      (site: { urlPrefix: string }) => site.urlPrefix === "github.com",
    );
    expect(github).toBeDefined();
    expect(github?.durationSeconds).toBe(8);
    expect(github?.pages[0]).toMatchObject({
      url: "https://github.com/org/repo",
      snapshotCount: 2,
      durationSeconds: 8,
    });

    const indexText = hooks.buildSessionIndexText(
      summary,
      "session-123",
      "2026-03-28T10:00:10.000Z",
    );
    expect(indexText).toContain("websitesOpened: 2");
    expect(indexText).toContain("urlsCaptured: 2");
    expect(indexText).toContain("snapshotCount: 3");
    expect(indexText).toContain("- host: github.com");
    expect(indexText).toContain("durationSeconds: 8");
    expect(indexText).toContain("url: https://github.com/org/repo");
  });

  it("includes index text inside export metadata payload", async () => {
    const { module } = await loadBackgroundWithHooks();
    const hooks = module.__testHooks;
    const summary = hooks.buildSessionSummary([
      {
        id: "1",
        createdAt: "2026-03-28T10:00:00.000Z",
        tabId: 1,
        windowId: 1,
        url: "https://github.com/org/repo",
        urlPrefix: "github.com",
        title: "Repo",
        reason: "poll-diff",
        timestamp: "2026-03-28T10:00:00.000Z",
        textContent: "a",
        sectionCount: 1,
        contentSizeBytes: 1,
      },
    ]);
    const indexText = hooks.buildSessionIndexText(
      summary,
      "session-xyz",
      "2026-03-28T10:00:01.000Z",
    );
    const metadata = hooks.buildExportMetadata({
      sessionId: "session-xyz",
      exportedAt: "2026-03-28T10:00:01.000Z",
      pageCount: 1,
      summary,
      indexText,
      settings: {
        preset: "pages_only",
        hardLimitMb: 256,
        autoExportOnSoftLimit: false,
        pollIntervalMs: 100,
        forceInitialScanOnStart: false,
        savePageText: true,
        savePageHtml: false,
        saveRequestData: false,
        savePageMeta: true,
      },
    });

    expect(metadata).toMatchObject({
      sessionId: "session-xyz",
      urlCount: 1,
      pageCount: 1,
      summary: {
        websitesOpened: 1,
        urlsCaptured: 1,
        snapshotCount: 1,
      },
      indexText,
    });
    expect(metadata.indexText).toContain("# Session Index");
    expect(metadata.websites).toHaveLength(1);
  });
});
