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

  it("returns default session and host queue stats", async () => {
    const { module } = await loadBackgroundWithHooks();
    const hooks = module.__testHooks;

    await expect(hooks.handleGetSessionStats()).resolves.toMatchObject({
      sessionId: null,
      pageCount: 0,
      droppedPageCount: 0,
      requestCount: 0,
      droppedRequestCount: 0,
      hostCount: 0,
    });
    await expect(hooks.handleGetHostQueueStats()).resolves.toMatchObject({
      distinctHostCount: 0,
      hosts: [],
    });
  });
});
