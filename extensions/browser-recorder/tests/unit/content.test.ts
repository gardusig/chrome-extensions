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
    Object.defineProperty(document, "body", {
      configurable: true,
      value: document.querySelector("body") ?? document.createElement("body"),
    });
    Object.defineProperty(document, "documentElement", {
      configurable: true,
      value: document.querySelector("html") ?? document.createElement("html"),
    });
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
          return {
            ok: true,
            settings: { pollIntervalMs: 300, savePageHtml: true, semanticCaptureLevel: "minimal" },
          };
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
      return {
        ok: true,
        settings: { pollIntervalMs: 120, savePageHtml: true, semanticCaptureLevel: "minimal" },
      };
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
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async () => ({
      ok: true,
      settings: { pollIntervalMs: 300, savePageHtml: false, semanticCaptureLevel: "minimal" },
    }));
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

  it("captures labeled chunks from semantic, shadow, and iframe sources", async () => {
    const chromeMock = createChromeMock() as ChromeMockWithInternals;
    const sentMessages: Array<{ type?: string; payload?: { textContent?: string } }> = [];
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const typed = message as { type?: string; payload?: { textContent?: string } };
      if (typed.type === "GET_SETTINGS") {
        return {
          ok: true,
          settings: { pollIntervalMs: 100, savePageHtml: false, semanticCaptureLevel: "full" },
        };
      }
      sentMessages.push(typed);
      return { ok: true };
    });
    globalThis.chrome = chromeMock;

    document.body.innerHTML = `
      <button aria-label="Send message">Send</button>
      <iframe id="frame-a"></iframe>
      <div id="shadow-host"></div>
    `;
    const frame = document.querySelector("iframe#frame-a")!;
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      get: () => ({
        body: {
          innerText: "iframe text",
        },
      }),
    });
    const host = document.querySelector("#shadow-host") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<p>shadow text</p>";
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      get: () => "body text",
    });

    window.__recorderContentBootstrapped = undefined;
    vi.resetModules();
    await import("../../src/content.ts");
    vi.advanceTimersByTime(120);

    const snapshots = sentMessages.filter((item) => item.type === "CONTENT_PAGE_SNAPSHOT");
    expect(snapshots.length).toBeGreaterThan(0);
    const textPayload = snapshots.at(-1)?.payload?.textContent ?? "";
    expect(textPayload).toContain("[source=body selector=body]");
    expect(textPayload).toContain("body text");
    expect(textPayload).toContain("[source=iframe");
    expect(textPayload).toContain("iframe text");
    expect(textPayload).toContain("[source=shadow");
    expect(textPayload).toContain("shadow text");
    expect(textPayload).toContain("[source=semantic");
    expect(textPayload).toContain("Send message");
  });

  it("ignores cross-origin iframe errors while capturing", async () => {
    const chromeMock = createChromeMock() as ChromeMockWithInternals;
    const sentMessages: Array<{ type?: string; payload?: { textContent?: string } }> = [];
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const typed = message as { type?: string; payload?: { textContent?: string } };
      if (typed.type === "GET_SETTINGS") {
        return {
          ok: true,
          settings: { pollIntervalMs: 100, savePageHtml: false, semanticCaptureLevel: "minimal" },
        };
      }
      sentMessages.push(typed);
      return { ok: true };
    });
    globalThis.chrome = chromeMock;

    document.body.innerHTML = `<iframe id="frame-throws"></iframe>`;
    const throwingFrame = document.querySelector("iframe#frame-throws")!;
    Object.defineProperty(throwingFrame, "contentDocument", {
      configurable: true,
      get: () => {
        throw new Error("cross-origin");
      },
    });
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      get: () => "body only",
    });

    window.__recorderContentBootstrapped = undefined;
    vi.resetModules();
    await import("../../src/content.ts");
    vi.advanceTimersByTime(120);

    const snapshot = sentMessages.find((item) => item.type === "CONTENT_PAGE_SNAPSHOT");
    expect(snapshot?.payload?.textContent ?? "").toContain("body only");
  });

  it("supports semantic level off and filters generic labels in minimal mode", async () => {
    const chromeMock = createChromeMock() as ChromeMockWithInternals;
    const sentMessages: Array<{ type?: string; payload?: { textContent?: string } }> = [];
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const typed = message as { type?: string; payload?: { textContent?: string } };
      if (typed.type === "GET_SETTINGS") {
        return {
          ok: true,
          settings: { pollIntervalMs: 100, savePageHtml: false, semanticCaptureLevel: "minimal" },
        };
      }
      sentMessages.push(typed);
      return { ok: true };
    });
    globalThis.chrome = chromeMock;

    document.body.innerHTML = `
      <button aria-label="Close">x</button>
      <button aria-label="Submit order">Checkout</button>
    `;
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      get: () => "body text",
    });

    window.__recorderContentBootstrapped = undefined;
    vi.resetModules();
    await import("../../src/content.ts");
    vi.advanceTimersByTime(120);

    const listener = chromeMock.__runtimeListeners.at(-1)!;
    await new Promise<unknown>((resolve) => {
      listener(
        {
          type: "CONTENT_UPDATE_SETTINGS",
          payload: { semanticCaptureLevel: "off" },
        },
        {},
        (response) => resolve(response),
      );
    });
    await new Promise<unknown>((resolve) => {
      listener(
        { type: "CAPTURE_NOW", payload: { reason: "manual", force: true } },
        {},
        (response) => resolve(response),
      );
    });

    const snapshots = sentMessages.filter((item) => item.type === "CONTENT_PAGE_SNAPSHOT");
    const minimalText = snapshots[0]?.payload?.textContent ?? "";
    expect(minimalText).toContain("Submit order");
    expect(minimalText).not.toContain("Close");

    const offText = snapshots.at(-1)?.payload?.textContent ?? "";
    expect(offText).toContain("[source=body selector=body]");
    expect(offText).not.toContain("[source=semantic");
  });

  it("medium level captures title attributes with minimal-style filtering", async () => {
    const chromeMock = createChromeMock() as ChromeMockWithInternals;
    const sentMessages: Array<{ type?: string; payload?: { textContent?: string } }> = [];
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const typed = message as { type?: string; payload?: { textContent?: string } };
      if (typed.type === "GET_SETTINGS") {
        return {
          ok: true,
          settings: { pollIntervalMs: 100, savePageHtml: false, semanticCaptureLevel: "medium" },
        };
      }
      sentMessages.push(typed);
      return { ok: true };
    });
    globalThis.chrome = chromeMock;

    document.body.innerHTML = `
      <a title="Documentation section overview">Docs</a>
    `;
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      get: () => "Docs",
    });

    window.__recorderContentBootstrapped = undefined;
    vi.resetModules();
    await import("../../src/content.ts");
    vi.advanceTimersByTime(120);

    const snapshot = sentMessages.find((item) => item.type === "CONTENT_PAGE_SNAPSHOT");
    const text = snapshot?.payload?.textContent ?? "";
    expect(text).toContain("[source=semantic");
    expect(text).toContain("Documentation section overview");
  });
});
