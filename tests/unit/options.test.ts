// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineStats, RecorderSettings } from "../../src/lib/schema";
import { createChromeMock } from "../support/chrome-mocks";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function mountOptionsDom(): void {
  document.body.innerHTML = `
    <input id="save-page-text" type="checkbox" />
    <select id="semantic-capture-level">
      <option value="off">off</option>
      <option value="minimal">minimal</option>
      <option value="full">full</option>
    </select>
    <input id="save-page-html" type="checkbox" />
    <input id="save-request-data" type="checkbox" />
    <input id="save-page-meta" type="checkbox" />
    <input id="save-export-metadata" type="checkbox" />
    <input id="force-initial-scan" type="checkbox" />
    <input id="poll-interval" type="number" />
    <select id="hard-limit-mb"><option value="8">8</option></select>
    <input id="auto-export" type="checkbox" />
    <strong id="queue-pending">0</strong>
    <strong id="queue-processing">0</strong>
    <strong id="queue-failed">0</strong>
    <strong id="queue-processed">0</strong>
    <strong id="total-bytes">0</strong>
    <strong id="compressed-bytes">0</strong>
    <div id="queue-updated-at"></div>
    <table><tbody id="prefix-table-body"></tbody></table>
    <div id="prefix-empty"></div>
    <button data-preset="pages_only"></button>
    <button data-preset="pages_requests"></button>
    <button data-preset="full_capture"></button>
    <button id="derive-preset"></button>
    <div id="message"></div>
  `;
}

describe("options", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mountOptionsDom();
  });

  it("loads settings, refreshes pipeline stats, and persists toggle changes", async () => {
    const baseSettings: RecorderSettings = {
      preset: "pages_only",
      hardLimitMb: 8,
      autoExportOnSoftLimit: false,
      pollIntervalMs: 350,
      forceInitialScanOnStart: false,
      semanticCaptureLevel: "minimal",
      savePageText: true,
      savePageHtml: false,
      saveRequestData: false,
      savePageMeta: true,
      saveExportMetadata: false,
    };
    const pipelineStats: PipelineStats = {
      queue: { pending: 2, processing: 1, failed: 0, processed: 12 },
      totals: {
        rawCount: 3,
        enrichedCount: 12,
        totalBytes: 1024 * 1024,
        estimatedCompressedBytes: 512 * 1024,
      },
      urlRows: [{ url: "https://app.slack.com/client/T123/C456", pageCount: 8, bytes: 900_000 }],
      generatedAt: "2026-03-28T22:00:00.000Z",
    };

    const chromeMock = createChromeMock();
    vi.spyOn(chromeMock.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      const request = message as { type?: string; payload?: Partial<RecorderSettings> };
      if (request.type === "GET_SETTINGS") {
        return { ok: true, settings: baseSettings };
      }
      if (request.type === "GET_PIPELINE_STATS") {
        return { ok: true, stats: pipelineStats };
      }
      if (request.type === "UPDATE_SETTINGS") {
        return { ok: true, settings: { ...baseSettings, ...request.payload } };
      }
      return { ok: true };
    });
    globalThis.chrome = chromeMock;

    vi.resetModules();
    await import("../../src/options.ts");
    await flushMicrotasks();

    expect(document.querySelector("#queue-pending")!.textContent).toBe("2");
    expect(document.querySelectorAll("#prefix-table-body tr").length).toBe(1);

    const savePageHtmlEl = document.querySelector("#save-page-html") as HTMLInputElement;
    savePageHtmlEl.checked = true;
    savePageHtmlEl.dispatchEvent(new Event("change"));
    await flushMicrotasks();
    expect(savePageHtmlEl.checked).toBe(true);

    const semanticLevelEl = document.querySelector("#semantic-capture-level") as HTMLSelectElement;
    semanticLevelEl.value = "full";
    semanticLevelEl.dispatchEvent(new Event("change"));
    await flushMicrotasks();
    expect(semanticLevelEl.value).toBe("full");
  });

  it("handles persistence failures, clamp logic, presets, and unload cleanup", async () => {
    const baseSettings: RecorderSettings = {
      preset: "full_capture",
      hardLimitMb: 8,
      autoExportOnSoftLimit: false,
      pollIntervalMs: 350,
      forceInitialScanOnStart: false,
      semanticCaptureLevel: "minimal",
      savePageText: true,
      savePageHtml: true,
      saveRequestData: true,
      savePageMeta: true,
      saveExportMetadata: false,
    };
    const emptyStats: PipelineStats = {
      queue: { pending: 0, processing: 0, failed: 0, processed: 0 },
      totals: {
        rawCount: 0,
        enrichedCount: 0,
        totalBytes: 512,
        estimatedCompressedBytes: 0,
      },
      urlRows: [],
      generatedAt: "invalid-date",
    };

    const chromeMock = createChromeMock();
    const sendMessageSpy = vi
      .spyOn(chromeMock.runtime, "sendMessage")
      .mockImplementation(async (message: unknown) => {
        const request = message as { type?: string; payload?: Partial<RecorderSettings> };
        if (request.type === "GET_SETTINGS") {
          return { ok: true, settings: baseSettings };
        }
        if (request.type === "GET_PIPELINE_STATS") {
          return { ok: true, stats: emptyStats };
        }
        if (request.type === "UPDATE_SETTINGS") {
          if (request.payload?.savePageText === false) {
            return { ok: false, error: "Unable to save settings." };
          }
          return { ok: true, settings: { ...baseSettings, ...request.payload } };
        }
        return { ok: true };
      });
    globalThis.chrome = chromeMock;

    vi.resetModules();
    await import("../../src/options.ts");
    await flushMicrotasks();

    const saveTextEl = document.querySelector("#save-page-text") as HTMLInputElement;
    saveTextEl.checked = false;
    saveTextEl.dispatchEvent(new Event("change"));
    await flushMicrotasks();
    expect(document.querySelector("#message")?.textContent).toContain("Unable to save settings");

    const pollIntervalEl = document.querySelector("#poll-interval") as HTMLInputElement;
    pollIntervalEl.value = "10";
    pollIntervalEl.dispatchEvent(new Event("change"));
    await flushMicrotasks();
    expect(pollIntervalEl.value).toBe("100");

    const presetBtn = document.querySelector('[data-preset="pages_requests"]') as HTMLButtonElement;
    presetBtn.click();
    await flushMicrotasks();

    const derivePresetBtn = document.querySelector("#derive-preset") as HTMLButtonElement;
    (document.querySelector("#save-page-html") as HTMLInputElement).checked = false;
    (document.querySelector("#save-request-data") as HTMLInputElement).checked = false;
    derivePresetBtn.click();
    await flushMicrotasks();

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "UPDATE_SETTINGS" }),
    );
    expect((document.querySelector("#prefix-empty") as HTMLElement).style.display).toBe("");
    expect(document.querySelector("#queue-updated-at")?.textContent).toContain("Updated: --");
    expect(document.querySelector("#total-bytes")?.textContent).toContain("B");

    window.dispatchEvent(new Event("unload"));
  });

  it("throws when required options DOM elements are missing", async () => {
    const chromeMock = createChromeMock();
    globalThis.chrome = chromeMock;
    document.body.innerHTML = "";
    vi.resetModules();
    await expect(import("../../src/options.ts")).rejects.toThrow("Missing options DOM elements.");
  });

  it("surfaces initialization error when GET_SETTINGS fails", async () => {
    const chromeMock = createChromeMock();
    vi.spyOn(chromeMock.runtime, "sendMessage").mockResolvedValue({
      ok: false,
      error: "settings unavailable",
    });
    globalThis.chrome = chromeMock;

    vi.resetModules();
    await import("../../src/options.ts");
    await flushMicrotasks();
    expect(document.querySelector("#message")?.textContent).toContain("settings unavailable");
  });
});
