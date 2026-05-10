// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "../support/chrome-mocks";

describe("content script (polling)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window as object & { __recorderBoot?: boolean }, "__recorderBoot");
    vi.useFakeTimers();
    document.documentElement.innerHTML =
      "<html><head><title>T</title></head><body><p>x</p></body></html>";
    Object.defineProperty(document.documentElement, "outerHTML", {
      configurable: true,
      get: () => "<html><head><title>T</title></head><body><p>x</p></body></html>",
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "https://example.com/page" },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends RECORDER_CAPTURE on interval when recording", async () => {
    const chromeMock = createChromeMock();
    vi.stubGlobal("chrome", chromeMock);
    const sendSpy = vi.spyOn(chromeMock.runtime, "sendMessage");

    await import("../../src/content");

    const chromeInternals = chromeMock as unknown as {
      __runtimeListeners: Array<
        (message: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => void
      >;
    };
    const listener = chromeInternals.__runtimeListeners.at(-1)!;
    listener(
      { type: "RECORDER_RECORDING", recording: true, pollIntervalMs: 100 },
      {},
      () => undefined,
    );

    vi.advanceTimersByTime(150);
    const types = sendSpy.mock.calls.map((c) => (c[0] as { type?: string }).type);
    expect(types).toContain("RECORDER_CAPTURE");
  });

  it("captures immediately when RECORDER_RECORDING requests immediate poll", async () => {
    const chromeMock = createChromeMock();
    vi.stubGlobal("chrome", chromeMock);
    const sendSpy = vi.spyOn(chromeMock.runtime, "sendMessage");

    await import("../../src/content");

    const chromeInternals = chromeMock as unknown as {
      __runtimeListeners: Array<
        (message: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => void
      >;
    };
    const listener = chromeInternals.__runtimeListeners.at(-1)!;
    listener(
      { type: "RECORDER_RECORDING", recording: true, pollIntervalMs: 500, immediatePoll: true },
      {},
      () => undefined,
    );

    const types = sendSpy.mock.calls.map((c) => (c[0] as { type?: string }).type);
    expect(types).toContain("RECORDER_CAPTURE");
  });
});
