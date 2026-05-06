// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecorderState, SessionStats } from "../../src/lib/schema";
import { createChromeMock } from "../support/chrome-mocks";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function mountPopupDom(): void {
  document.body.innerHTML = `
    <div id="status"></div>
    <div id="stats"></div>
    <div id="message"></div>
    <button id="start-btn" type="button">Start</button>
    <button id="stop-btn" type="button">Stop</button>
    <button id="export-btn" type="button">Export</button>
    <button id="clear-btn" type="button">Clear</button>
    <button id="open-settings-btn" type="button">Settings</button>
    <dialog id="clear-dialog"></dialog>
    <button id="dlg-trim" type="button">Trim</button>
    <button id="dlg-full" type="button">Full</button>
    <button id="dlg-cancel" type="button">Cancel</button>
  `;
}

function baseState(over: Partial<RecorderState> = {}): RecorderState {
  return {
    isRecording: false,
    sessionId: null,
    startedAt: null,
    stoppedAt: null,
    storageBytesTotal: 1024,
    storageBytesRaw: 512,
    storageBytesProcessed: 512,
    ...over,
  };
}

function baseStats(): SessionStats {
  return {
    urlCount: 1,
    snapshotCount: 2,
    storageBytesRaw: 0,
    storageBytesProcessed: 512,
    storageBytesTotal: 512,
  };
}

describe("popup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    mountPopupDom();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.dispatchEvent(new Event("unload"));
  });

  it("disables export and clear while recording", async () => {
    const chromeMock = createChromeMock();
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const type = (message as { type?: string }).type;
      if (type === "GET_STATE") {
        return { ok: true, state: baseState({ isRecording: true, sessionId: "session-1" }) };
      }
      if (type === "GET_SESSION_STATS") {
        return { ok: true, stats: baseStats() };
      }
      if (type === "GET_SETTINGS") {
        return {
          ok: true,
          settings: { pollIntervalMs: 500, limitForceStopMb: 32 },
        };
      }
      return { ok: true };
    });
    vi.stubGlobal("chrome", chromeMock);

    await import("../../src/popup.ts");
    await flushMicrotasks();

    expect((document.querySelector("#export-btn") as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector("#clear-btn") as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends STOP_RECORDING when stop is clicked", async () => {
    const chromeMock = createChromeMock();
    const sendSpy = vi
      .spyOn(chromeMock.runtime, "sendMessage")
      .mockImplementation(async (message: unknown) => {
        const type = (message as { type?: string }).type;
        if (type === "GET_STATE") {
          return { ok: true, state: baseState({ isRecording: true, sessionId: "s" }) };
        }
        if (type === "GET_SESSION_STATS") {
          return { ok: true, stats: baseStats() };
        }
        if (type === "GET_SETTINGS") {
          return {
            ok: true,
            settings: { pollIntervalMs: 500, limitForceStopMb: 32 },
          };
        }
        if (type === "STOP_RECORDING") {
          return {
            ok: true,
            state: baseState({ isRecording: false, stoppedAt: "2026-01-01T00:00:00.000Z" }),
          };
        }
        return { ok: true };
      });
    vi.stubGlobal("chrome", chromeMock);

    await import("../../src/popup.ts");
    await flushMicrotasks();

    (document.querySelector("#stop-btn") as HTMLButtonElement).click();
    await flushMicrotasks();

    const types = sendSpy.mock.calls.map((c) => (c[0] as { type?: string }).type);
    expect(types).toContain("STOP_RECORDING");
  });

  it("opens clear dialog without fetching suggestions", async () => {
    const chromeMock = createChromeMock();
    const sendSpy = vi
      .spyOn(chromeMock.runtime, "sendMessage")
      .mockImplementation(async (message: unknown) => {
        const type = (message as { type?: string }).type;
        if (type === "GET_STATE") {
          return { ok: true, state: baseState() };
        }
        if (type === "GET_SESSION_STATS") {
          return { ok: true, stats: baseStats() };
        }
        if (type === "GET_SETTINGS") {
          return {
            ok: true,
            settings: { pollIntervalMs: 500, limitForceStopMb: 32 },
          };
        }
        if (type === "CLEAR_TRIM") {
          return { ok: true };
        }
        return { ok: true };
      });
    vi.stubGlobal("chrome", chromeMock);

    await import("../../src/popup.ts");
    await flushMicrotasks();

    (document.querySelector("#clear-btn") as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(sendSpy.mock.calls.map((c) => (c[0] as { type?: string }).type)).not.toContain(
      "GET_CLEAR_SUGGESTIONS",
    );
    expect(document.querySelector("#clear-dialog")?.hasAttribute("open")).toBe(true);

    (document.querySelector("#dlg-trim") as HTMLButtonElement).click();
    await flushMicrotasks();

    const types = sendSpy.mock.calls.map((c) => (c[0] as { type?: string }).type);
    expect(types).toContain("CLEAR_TRIM");
  });

  it("disables start when recording is blocked by size", async () => {
    const chromeMock = createChromeMock();
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const type = (message as { type?: string }).type;
      if (type === "GET_STATE") {
        return {
          ok: true,
          state: baseState({
            isRecording: false,
            storageBytesProcessed: 40 * 1024 * 1024,
            storageBytesTotal: 40 * 1024 * 1024,
            recordingBlockedForLimit: true,
            forceStoppedForLimit: true,
          }),
        };
      }
      if (type === "GET_SETTINGS") {
        return {
          ok: true,
          settings: { pollIntervalMs: 500, limitForceStopMb: 32 },
        };
      }
      if (type === "GET_SESSION_STATS") {
        return { ok: true, stats: baseStats() };
      }
      return { ok: true };
    });
    vi.stubGlobal("chrome", chromeMock);

    await import("../../src/popup.ts");
    await flushMicrotasks();

    expect((document.querySelector("#start-btn") as HTMLButtonElement).disabled).toBe(true);
  });
});
