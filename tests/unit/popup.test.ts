// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecorderState, SessionStats } from "../../src/lib/schema";
import { createChromeMock } from "../support/chrome-mocks";

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
      hostCount: 2,
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
          return { ok: true, pageCount: 3, hostCount: 2 };
        }
        if (type === "CLEAR_SESSION_DATA") {
          return { ok: true, cleared: true };
        }
        return { ok: true };
      });
    globalThis.chrome = chromeMock;

    vi.resetModules();
    await import("../../src/popup.ts");
    await Promise.resolve();

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
});
