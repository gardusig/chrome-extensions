// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("content script", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    document.body.innerHTML = "<main>Hello recorder</main>";
    document.title = "Test page";
    window.history.replaceState({}, "", "/path");
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      get: () => "Hello recorder",
    });
    Object.defineProperty(document.documentElement, "outerHTML", {
      configurable: true,
      get: () => "<html><body>Hello recorder</body></html>",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bootstraps once and handles CAPTURE_NOW / CONTENT_UPDATE_SETTINGS", async () => {
    const chromeMock = createChromeMock() as ChromeMockWithInternals;
    const sendMessageSpy = vi
      .spyOn(chromeMock.runtime, "sendMessage")
      .mockImplementation(async (message: unknown) => {
        if ((message as { type?: string }).type === "GET_SETTINGS") {
          return { ok: true, settings: { pollIntervalMs: 300, savePageHtml: true } };
        }
        return { ok: true };
      });

    globalThis.chrome = chromeMock;
    window.__recorderContentBootstrapped = undefined;
    vi.resetModules();
    await import("../../src/content.ts");

    const listener = chromeMock.__runtimeListeners.at(-1);
    expect(listener).toBeDefined();

    const captureResponse = await new Promise<unknown>((resolve) => {
      listener!(
        { type: "CAPTURE_NOW", payload: { reason: "manual", force: true, includeHtml: true } },
        {},
        (response) => resolve(response),
      );
    });
    expect(captureResponse).toEqual({ ok: true });

    const captureDefaults = await new Promise<unknown>((resolve) => {
      listener!({ type: "CAPTURE_NOW" }, {}, (response) => resolve(response));
    });
    expect(captureDefaults).toEqual({ ok: true });

    const updateResponse = await new Promise<unknown>((resolve) => {
      listener!(
        {
          type: "CONTENT_UPDATE_SETTINGS",
          payload: { pollIntervalMs: 200, savePageHtml: false },
        },
        {},
        (response) => resolve(response),
      );
    });
    expect(updateResponse).toEqual({ ok: true });

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CONTENT_PAGE_SNAPSHOT" }),
    );

    await import("../../src/content.ts");
    expect(chromeMock.__runtimeListeners).toHaveLength(1);
  });

  it("handles browser events, timer loop and GET_SETTINGS failures", async () => {
    const chromeMock = createChromeMock() as ChromeMockWithInternals;
    let firstCall = true;
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const type = (message as { type?: string }).type;
      if (type === "GET_SETTINGS" && firstCall) {
        firstCall = false;
        throw new Error("worker unavailable");
      }
      return { ok: true, settings: { pollIntervalMs: 120, savePageHtml: true } };
    });

    globalThis.chrome = chromeMock;
    window.__recorderContentBootstrapped = undefined;
    vi.resetModules();
    await import("../../src/content.ts");

    window.dispatchEvent(new Event("click"));
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("keydown"));
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.dispatchEvent(new Event("load"));
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("beforeunload"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    window.dispatchEvent(new Event("visibilitychange"));

    history.pushState({}, "", "/push");
    history.replaceState({}, "", "/replace");

    vi.advanceTimersByTime(1_000);
    window.dispatchEvent(new Event("unload"));

    expect(chromeMock.__runtimeListeners.at(-1)).toBeDefined();
  });

  it("handles loading readyState path and unknown runtime messages", async () => {
    const chromeMock = createChromeMock() as ChromeMockWithInternals;
    vi.spyOn(chromeMock.runtime, "sendMessage").mockResolvedValue({
      ok: true,
      settings: { pollIntervalMs: 300, savePageHtml: false },
    });
    globalThis.chrome = chromeMock;

    Object.defineProperty(document, "readyState", { configurable: true, value: "loading" });
    Object.defineProperty(document, "body", {
      configurable: true,
      get: () => null,
    });
    Object.defineProperty(document, "documentElement", {
      configurable: true,
      get: () => null,
    });

    window.__recorderContentBootstrapped = undefined;
    vi.resetModules();
    await import("../../src/content.ts");

    window.dispatchEvent(new Event("DOMContentLoaded"));

    const listener = chromeMock.__runtimeListeners.at(-1)!;
    const unknown = listener({ type: "UNKNOWN" }, {}, () => undefined);
    expect(unknown).toBe(false);
  });
});
