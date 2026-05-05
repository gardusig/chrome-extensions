// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecorderSettings } from "../../src/lib/schema";
import { createChromeMock } from "../support/chrome-mocks";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function mountOptionsDom(): void {
  document.body.innerHTML = `
    <input id="poll-interval" type="number" />
    <input id="limit-force-stop-mb" type="number" />
    <input id="target-after-cleanup-mb" type="number" />
    <div id="message"></div>
  `;
}

describe("options", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mountOptionsDom();
  });

  it("loads settings into inputs", async () => {
    const settings: RecorderSettings = {
      pollIntervalMs: 250,
      limitForceStopMb: 32,
      targetAfterCleanupMb: 16,
    };

    const chromeMock = createChromeMock();
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const request = message as { type?: string };
      if (request.type === "GET_SETTINGS") {
        return { ok: true, settings };
      }
      return { ok: true };
    });
    vi.stubGlobal("chrome", chromeMock);

    vi.resetModules();
    await import("../../src/options.ts");
    await flushMicrotasks();

    expect((document.querySelector("#poll-interval") as HTMLInputElement).value).toBe("250");
    expect((document.querySelector("#limit-force-stop-mb") as HTMLInputElement).value).toBe("32");
    expect((document.querySelector("#target-after-cleanup-mb") as HTMLInputElement).value).toBe(
      "16",
    );
  });

  it("persists on change via UPDATE_SETTINGS", async () => {
    const settings: RecorderSettings = {
      pollIntervalMs: 200,
      limitForceStopMb: 64,
      targetAfterCleanupMb: 32,
    };

    const chromeMock = createChromeMock();
    const sendSpy = vi
      .spyOn(chromeMock.runtime, "sendMessage")
      .mockImplementation(async (message: unknown) => {
        const request = message as { type?: string; payload?: Partial<RecorderSettings> };
        if (request.type === "GET_SETTINGS") {
          return { ok: true, settings };
        }
        if (request.type === "UPDATE_SETTINGS") {
          return { ok: true };
        }
        return { ok: true };
      });
    vi.stubGlobal("chrome", chromeMock);

    vi.resetModules();
    await import("../../src/options.ts");
    await flushMicrotasks();

    const pollEl = document.querySelector("#poll-interval") as HTMLInputElement;
    pollEl.value = "400";
    pollEl.dispatchEvent(new Event("change"));
    await flushMicrotasks();

    const updateCalls = sendSpy.mock.calls.filter(
      (c) => (c[0] as { type?: string }).type === "UPDATE_SETTINGS",
    );
    expect(updateCalls.length).toBeGreaterThan(0);
    const payload = (updateCalls.at(-1)?.[0] as { payload?: RecorderSettings }).payload;
    expect(payload?.pollIntervalMs).toBe(400);
  });
});
