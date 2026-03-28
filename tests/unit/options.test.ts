// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineStats, RecorderSettings } from "../../src/lib/schema";
import { createChromeMock } from "../support/chrome-mocks";

function mountOptionsDom(): void {
  document.body.innerHTML = `
    <input id="save-page-text" type="checkbox" />
    <input id="save-page-html" type="checkbox" />
    <input id="save-request-data" type="checkbox" />
    <input id="save-page-meta" type="checkbox" />
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
      savePageText: true,
      savePageHtml: false,
      saveRequestData: false,
      savePageMeta: true,
    };
    const pipelineStats: PipelineStats = {
      queue: { pending: 2, processing: 1, failed: 0, processed: 12 },
      totals: {
        rawCount: 3,
        enrichedCount: 12,
        totalBytes: 1024 * 1024,
        estimatedCompressedBytes: 512 * 1024,
      },
      urlPrefixRows: [{ urlPrefix: "app.slack.com", pageCount: 8, bytes: 900_000 }],
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
    await Promise.resolve();

    expect(document.querySelector("#queue-pending")!.textContent).toBe("2");
    expect(document.querySelectorAll("#prefix-table-body tr").length).toBe(1);

    const savePageHtmlEl = document.querySelector("#save-page-html") as HTMLInputElement;
    savePageHtmlEl.checked = true;
    savePageHtmlEl.dispatchEvent(new Event("change"));
    await Promise.resolve();
    expect(savePageHtmlEl.checked).toBe(true);
  });
});
