import { describe, expect, it } from "vitest";
import { exportSessionRecords, sanitizePathPart } from "../../../src/lib/export";
import type { RecorderSettings } from "../../../src/lib/schema";

const settings: RecorderSettings = {
  preset: "full_capture",
  hardLimitMb: 8,
  autoExportOnSoftLimit: false,
  pollIntervalMs: 350,
  forceInitialScanOnStart: true,
  semanticCaptureLevel: "minimal",
  savePageText: true,
  savePageHtml: true,
  saveRequestData: true,
  savePageMeta: true,
  saveExportMetadata: false,
};

describe("sanitizePathPart", () => {
  it("replaces non-safe characters", () => {
    expect(sanitizePathPart("a:b/c d")).toBe("a_b_c_d");
  });
});

describe("exportSessionRecords unit branches", () => {
  it("handles unknown host and no requests", async () => {
    const writes: Array<{ filename: string; content: string }> = [];
    const result = await exportSessionRecords({
      sessionId: "s:1",
      metadata: { startedAt: null, stoppedAt: null },
      pages: [
        {
          id: "p1",
          sessionId: "s:1",
          timestamp: "invalid",
          tabId: 1,
          windowId: 1,
          url: "not-a-url",
          title: "Unknown",
          reason: "test",
          textContent: "",
          htmlContent: "",
        },
      ],
      requests: [],
      recorderSettings: { ...settings, savePageMeta: false },
      droppedPageCount: 1,
      droppedRequestCount: 2,
      storageBytesInUse: 42,
      storageLimits: { softLimitBytes: 1, hardLimitBytes: 2, trimTargetBytes: 0 },
      downloadTextFile: async (filename, content) => {
        writes.push({ filename, content });
      },
      now: () => "2026-03-28T00:00:00.000Z",
    });

    expect(writes).toHaveLength(3);
    expect(writes[0].filename).toContain("/pages/unknown.txt");
    expect(writes[0].content).toContain("# Host: unknown");
    expect(writes[1].filename).toContain("/pages/unknown.jsonl");
    expect(JSON.parse(writes[1].content)).toMatchObject({
      sessionId: "s:1",
      tabId: 1,
      url: "not-a-url",
      sections: [],
    });
    expect(writes[2].filename).toContain("session-metadata.json");
    expect(result).toEqual({
      sessionId: "s:1",
      pageCount: 1,
      requestCount: 0,
      droppedPageCount: 1,
      droppedRequestCount: 2,
      hostCount: 1,
    });
  });

  it("sorts requests with invalid timestamps and optional initiator", async () => {
    const writes: Array<{ filename: string; content: string }> = [];
    await exportSessionRecords({
      sessionId: "s2",
      metadata: { startedAt: null, stoppedAt: null },
      pages: [],
      requests: [
        {
          id: "r1",
          sessionId: "s2",
          timestamp: "invalid",
          tabId: 1,
          windowId: 1,
          type: "fetch",
          method: "GET",
          url: "https://same-host.example.com/a",
        },
        {
          id: "r2",
          sessionId: "s2",
          timestamp: "2026-03-28T00:00:00.000Z",
          tabId: 1,
          windowId: 1,
          type: "fetch",
          method: "POST",
          url: "https://same-host.example.com/b",
          initiator: "https://example.com",
        },
      ],
      recorderSettings: settings,
      droppedPageCount: 0,
      droppedRequestCount: 0,
      storageBytesInUse: 1,
      storageLimits: { softLimitBytes: 1, hardLimitBytes: 2, trimTargetBytes: 0 },
      downloadTextFile: async (filename, content) => {
        writes.push({ filename, content });
      },
    });

    const requestFile = writes.find((entry) =>
      entry.filename.includes("/requests/same-host.example.com.txt"),
    );
    expect(requestFile).toBeDefined();
    expect(requestFile!.content).toContain("method: GET");
    expect((requestFile!.content.match(/initiator:/g) ?? []).length).toBe(1);
  });
});
