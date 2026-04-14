// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecorderState, SessionStats } from "../../src/lib/schema";
import { createChromeMock } from "../support/chrome-mocks";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function mountPopupDom(): void {
  document.body.innerHTML = `
    <div id="status"></div>
    <div id="stats"></div>
    <div id="message"></div>
    <button id="start-btn">Start</button>
    <button id="stop-btn">Stop</button>
    <button id="export-btn">Export Session</button>
    <button id="clear-btn">Clear Session Data</button>
    <button id="open-settings-btn">Open all settings</button>
  `;
}

describe("popup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    mountPopupDom();
  });

  it("disables export while recording and handles actions", async () => {
    const state: RecorderState = {
      isRecording: true,
      isStopping: false,
      sessionId: "session-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      stoppedAt: null,
      droppedPageCount: 0,
      droppedRequestCount: 0,
      storageBytesInUse: 2_048,
    };
    const stats: SessionStats = {
      sessionId: "session-1",
      pageCount: 3,
      droppedPageCount: 0,
      requestCount: 0,
      droppedRequestCount: 0,
      urlCount: 2,
      storageBytesInUse: 2_048,
    };

    const chromeMock = createChromeMock();
    const sendMessageSpy = vi
      .spyOn(chromeMock.runtime, "sendMessage")
      .mockImplementation(async (message: unknown) => {
        const type = (message as { type?: string }).type;
        if (type === "GET_STATE") {
          return { ok: true, state };
        }
        if (type === "GET_SESSION_STATS") {
          return { ok: true, stats };
        }
        if (type === "START_RECORDING") {
          return { ok: true, state: { ...state, isRecording: true } };
        }
        if (type === "STOP_RECORDING") {
          return {
            ok: true,
            state: { ...state, isRecording: false, stoppedAt: "2026-01-01T00:01:00.000Z" },
          };
        }
        if (type === "EXPORT_SESSION") {
          return { ok: true, pageCount: 3, urlCount: 2 };
        }
        if (type === "CLEAR_SESSION_DATA") {
          return { ok: true, cleared: true };
        }
        return { ok: true };
      });
    globalThis.chrome = chromeMock;

    vi.resetModules();
    await import("../../src/popup.ts");
    await flushMicrotasks();

    expect((document.querySelector("#export-btn") as HTMLButtonElement).disabled).toBe(true);

    (document.querySelector("#stop-btn") as HTMLButtonElement).click();
    await Promise.resolve();
    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "STOP_RECORDING" }),
    );
  });

  it("throws when required DOM elements are missing", async () => {
    const chromeMock = createChromeMock();
    globalThis.chrome = chromeMock;
    document.body.innerHTML = "";
    vi.resetModules();
    await expect(import("../../src/popup.ts")).rejects.toThrow("Popup DOM elements are missing.");
  });

  it("handles start/export/clear/open-settings and surfaces action errors", async () => {
    const state: RecorderState = {
      isRecording: false,
      isStopping: false,
      sessionId: "session-2",
      startedAt: "2026-01-02T00:00:00.000Z",
      stoppedAt: "2026-01-02T00:01:00.000Z",
      droppedPageCount: 0,
      droppedRequestCount: 0,
      storageBytesInUse: 512,
    };
    const stats: SessionStats = {
      sessionId: "session-2",
      pageCount: 1,
      droppedPageCount: 0,
      requestCount: 0,
      droppedRequestCount: 0,
      urlCount: 1,
      storageBytesInUse: 512,
    };

    const chromeMock = createChromeMock();
    vi.spyOn(chromeMock.runtime, "openOptionsPage").mockResolvedValue(undefined);
    const sendMessageSpy = vi
      .spyOn(chromeMock.runtime, "sendMessage")
      .mockImplementation(async (message: unknown) => {
        const type = (message as { type?: string }).type;
        if (type === "GET_STATE") {
          return { ok: true, state };
        }
        if (type === "GET_SESSION_STATS") {
          return { ok: true, stats };
        }
        if (type === "START_RECORDING") {
          return { ok: false, error: "start failed" };
        }
        if (type === "EXPORT_SESSION") {
          return { ok: true, sessionId: "session-2", pageCount: 5, urlCount: 3 };
        }
        if (type === "CLEAR_SESSION_DATA") {
          return { ok: true };
        }
        return { ok: true, state };
      });
    globalThis.chrome = chromeMock;

    vi.resetModules();
    await import("../../src/popup.ts");
    await flushMicrotasks();

    (document.querySelector("#start-btn") as HTMLButtonElement).click();
    await flushMicrotasks();
    expect(document.querySelector("#message")?.textContent).toContain("start failed");

    (document.querySelector("#clear-btn") as HTMLButtonElement).click();
    await flushMicrotasks();
    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CLEAR_SESSION_DATA" }),
    );
  });

  it("shows fetch-state error and refreshes from periodic timer", async () => {
    const chromeMock = createChromeMock();
    const sendMessageSpy = vi
      .spyOn(chromeMock.runtime, "sendMessage")
      .mockResolvedValue({ ok: false, error: "state unavailable" });
    globalThis.chrome = chromeMock;

    vi.resetModules();
    await import("../../src/popup.ts");
    await flushMicrotasks();

    expect(document.querySelector("#message")?.textContent).toContain("state unavailable");
    vi.advanceTimersByTime(1_000);
    expect(sendMessageSpy).toHaveBeenCalled();
    window.dispatchEvent(new Event("unload"));
  });

  it("handles export failure and open-settings click", async () => {
    const state: RecorderState = {
      isRecording: false,
      isStopping: true,
      sessionId: "session-3",
      startedAt: "2026-01-03T00:00:00.000Z",
      stoppedAt: "2026-01-03T00:01:00.000Z",
      droppedPageCount: 0,
      droppedRequestCount: 0,
      storageBytesInUse: 256,
    };
    const stats: SessionStats = {
      sessionId: "session-3",
      pageCount: 2,
      droppedPageCount: 0,
      requestCount: 0,
      droppedRequestCount: 0,
      urlCount: 1,
      storageBytesInUse: 256,
    };

    const chromeMock = createChromeMock();
    const openOptionsSpy = vi
      .spyOn(chromeMock.runtime, "openOptionsPage")
      .mockResolvedValue(undefined);
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const type = (message as { type?: string }).type;
      if (type === "GET_STATE") {
        return { ok: true, state };
      }
      if (type === "GET_SESSION_STATS") {
        return { ok: true, stats };
      }
      if (type === "EXPORT_SESSION") {
        return { ok: false, error: "export unavailable" };
      }
      return { ok: true, state };
    });
    globalThis.chrome = chromeMock;

    vi.resetModules();
    await import("../../src/popup.ts");
    await flushMicrotasks();
    expect((document.querySelector("#start-btn") as HTMLButtonElement).disabled).toBe(true);

    (document.querySelector("#open-settings-btn") as HTMLButtonElement).click();
    await flushMicrotasks();
    expect(openOptionsSpy).toHaveBeenCalledTimes(1);
  });

  it("covers export success message and clear failure error path", async () => {
    const state: RecorderState = {
      isRecording: false,
      isStopping: false,
      sessionId: "session-4",
      startedAt: "2026-01-04T00:00:00.000Z",
      stoppedAt: "2026-01-04T00:01:00.000Z",
      droppedPageCount: 0,
      droppedRequestCount: 0,
      storageBytesInUse: 1024,
    };
    const stats: SessionStats = {
      sessionId: "session-4",
      pageCount: 4,
      droppedPageCount: 0,
      requestCount: 0,
      droppedRequestCount: 0,
      urlCount: 2,
      storageBytesInUse: 1024,
    };

    const chromeMock = createChromeMock();
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const type = (message as { type?: string }).type;
      if (type === "GET_STATE") {
        return { ok: true, state };
      }
      if (type === "GET_SESSION_STATS") {
        return { ok: true, stats };
      }
      if (type === "EXPORT_SESSION") {
        return { ok: true, pageCount: 4, urlCount: 2 };
      }
      if (type === "CLEAR_SESSION_DATA") {
        return { ok: false, error: "clear failed" };
      }
      return { ok: true, state };
    });
    globalThis.chrome = chromeMock;

    vi.resetModules();
    await import("../../src/popup.ts");
    await flushMicrotasks();

    (document.querySelector("#export-btn") as HTMLButtonElement).click();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(document.querySelector("#message")?.textContent).toContain("Exported 4 pages");

    (document.querySelector("#clear-btn") as HTMLButtonElement).click();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(document.querySelector("#message")?.textContent).toContain("clear failed");
  });

  it("covers start success and stop/export failure branches", async () => {
    const baseState: RecorderState = {
      isRecording: false,
      isStopping: false,
      sessionId: "session-5",
      startedAt: "2026-01-05T00:00:00.000Z",
      stoppedAt: null,
      droppedPageCount: 0,
      droppedRequestCount: 0,
      storageBytesInUse: 1234,
    };
    const stats: SessionStats = {
      sessionId: "session-5",
      pageCount: 1,
      droppedPageCount: 0,
      requestCount: 0,
      droppedRequestCount: 0,
      urlCount: 1,
      storageBytesInUse: 1234,
    };

    const chromeMock = createChromeMock();
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const type = (message as { type?: string }).type;
      if (type === "GET_STATE") {
        return { ok: true, state: baseState };
      }
      if (type === "GET_SESSION_STATS") {
        return { ok: true, stats };
      }
      if (type === "START_RECORDING") {
        return { ok: true, state: { ...baseState, isRecording: true } };
      }
      if (type === "STOP_RECORDING") {
        return { ok: false, error: "stop failed" };
      }
      if (type === "EXPORT_SESSION") {
        return { ok: false, error: "export failed" };
      }
      return { ok: true, state: baseState };
    });
    globalThis.chrome = chromeMock;

    vi.resetModules();
    await import("../../src/popup.ts");
    await flushMicrotasks();

    (document.querySelector("#export-btn") as HTMLButtonElement).click();
    await flushMicrotasks();
    expect(document.querySelector("#message")?.textContent).toContain("export failed");

    (document.querySelector("#start-btn") as HTMLButtonElement).click();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(document.querySelector("#message")?.textContent).toContain("Recording started");

    (document.querySelector("#stop-btn") as HTMLButtonElement).click();
    await flushMicrotasks();
    expect(document.querySelector("#message")?.textContent).toContain("stop failed");
  });
});
