import { describe, expect, it, vi } from "vitest";
import { exportSessionRecords, sanitizePathPart } from "../../src/lib/export";
import type { PageSnapshotRecord, RecorderSettings, RequestRecord } from "../../src/lib/schema";

function decodeDataUrl(dataUrl: string): string {
  const prefix = "data:text/plain;charset=utf-8,";
  expect(dataUrl.startsWith(prefix)).toBe(true);
  return decodeURIComponent(dataUrl.slice(prefix.length));
}

describe("exportSessionRecords integration", () => {
  it("exports per-host text files and metadata for github/gist/jira tabs", async () => {
    const sessionId = "session:throughput/001";
    const recorderSettings: RecorderSettings = {
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

    const pages: PageSnapshotRecord[] = [
      {
        id: "p1",
        sessionId,
        timestamp: "2026-03-28T10:00:02.000Z",
        tabId: 11,
        windowId: 1,
        url: "https://github.com/org/repo?token=%5BREDACTED%5D",
        title: "org/repo",
        reason: "interval",
        textContent: "GET /api/repos?per_page=10\nResponse: 200 OK",
        htmlContent: "<html><body><h1>Repository</h1></body></html>",
      },
      {
        id: "p2",
        sessionId,
        timestamp: "2026-03-28T10:00:03.000Z",
        tabId: 12,
        windowId: 1,
        url: "https://gist.github.com/user/abc",
        title: "gist snippet",
        reason: "navigation",
        textContent: "GET /api/gists/abc\nResponse: 200 OK",
        htmlContent: "<html><body><article>Gist content</article></body></html>",
      },
      {
        id: "p3",
        sessionId,
        timestamp: "2026-03-28T10:00:01.000Z",
        tabId: 13,
        windowId: 1,
        url: "https://jira.example.com/browse/ENG-42",
        title: "ENG-42",
        reason: "recording-start-initial-scan",
        textContent: "Issue\nGET /rest/api/3/issue/ENG-42\nResponse: 200 OK",
        htmlContent: "<html><body><main><h1>Issue</h1><p>Issue details</p></main></body></html>",
      },
      {
        id: "p4",
        sessionId,
        timestamp: "2026-03-28T10:00:04.000Z",
        tabId: 11,
        windowId: 1,
        url: "https://github.com/org/repo/pulls",
        title: "Pull Requests",
        reason: "manual-capture",
        textContent:
          "Home\nChannels\nDirect messages\nPaul Robotson APP  Yesterday at 3:49 PM\nReply…\nGET /api/pulls?state=open\nResponse: 200 OK",
        htmlContent: "<html><body><section>PR list</section></body></html>",
      },
    ];

    const requests: RequestRecord[] = [
      {
        id: "r1",
        sessionId,
        timestamp: "2026-03-28T10:00:05.000Z",
        tabId: 11,
        windowId: 1,
        type: "xmlhttprequest",
        method: "GET",
        url: "https://api.github.com/repos/org/repo/issues",
        initiator: "https://github.com",
      },
      {
        id: "r2",
        sessionId,
        timestamp: "2026-03-28T10:00:06.000Z",
        tabId: 12,
        windowId: 1,
        type: "fetch",
        method: "GET",
        url: "https://gist.github.com/api/gists/abc",
        initiator: "https://gist.github.com",
      },
      {
        id: "r3",
        sessionId,
        timestamp: "2026-03-28T10:00:07.000Z",
        tabId: 13,
        windowId: 1,
        type: "xmlhttprequest",
        method: "POST",
        url: "https://jira.example.com/rest/api/3/search",
        initiator: "https://jira.example.com",
      },
    ];

    const downloadCalls: chrome.downloads.DownloadOptions[] = [];
    const downloadMock = vi.fn(
      async (options: chrome.downloads.DownloadOptions): Promise<number> => {
        downloadCalls.push(options);
        return downloadCalls.length;
      },
    );

    const downloadTextFile = async (filename: string, content: string): Promise<void> => {
      await downloadMock({
        url: `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`,
        filename,
        saveAs: false,
        conflictAction: "uniquify",
      });
    };

    const result = await exportSessionRecords({
      sessionId,
      metadata: {
        startedAt: "2026-03-28T09:59:59.000Z",
        stoppedAt: "2026-03-28T10:01:00.000Z",
      },
      pages,
      requests,
      recorderSettings,
      droppedPageCount: 0,
      droppedRequestCount: 0,
      storageBytesInUse: 5_120,
      storageLimits: {
        softLimitBytes: 7_340_032,
        hardLimitBytes: 8_388_608,
        trimTargetBytes: 6_291_456,
      },
      downloadTextFile,
      now: () => "2026-03-28T10:01:01.000Z",
    });

    const safeSessionId = sanitizePathPart(sessionId);
    expect(downloadCalls).toHaveLength(10);

    const byFilename = new Map(
      downloadCalls.map((call) => [call.filename as string, decodeDataUrl(call.url as string)]),
    );

    expect(byFilename.has(`recordings/${safeSessionId}/pages/github.com.txt`)).toBe(true);
    expect(byFilename.has(`recordings/${safeSessionId}/pages/github.com.jsonl`)).toBe(true);
    expect(byFilename.has(`recordings/${safeSessionId}/pages/gist.github.com.txt`)).toBe(true);
    expect(byFilename.has(`recordings/${safeSessionId}/pages/gist.github.com.jsonl`)).toBe(true);
    expect(byFilename.has(`recordings/${safeSessionId}/pages/jira.example.com.txt`)).toBe(true);
    expect(byFilename.has(`recordings/${safeSessionId}/pages/jira.example.com.jsonl`)).toBe(true);
    expect(byFilename.has(`recordings/${safeSessionId}/requests/api.github.com.txt`)).toBe(true);
    expect(byFilename.has(`recordings/${safeSessionId}/requests/gist.github.com.txt`)).toBe(true);
    expect(byFilename.has(`recordings/${safeSessionId}/requests/jira.example.com.txt`)).toBe(true);

    const githubPages = byFilename.get(`recordings/${safeSessionId}/pages/github.com.txt`);
    expect(githubPages).toBeDefined();
    expect(githubPages).toContain("# Host: github.com");
    expect(githubPages).toContain("snapshotCount: 2");
    expect(githubPages).toContain("sections:");
    expect(githubPages).toContain("=== section:");
    expect(githubPages).toContain("\t");
    expect(githubPages).toContain("GET /api/repos?per_page=10");
    expect(githubPages).toContain("<h1>Repository</h1>");
    expect(githubPages).toContain("token=%5BREDACTED%5D");
    expect(githubPages!.indexOf("2026-03-28T10:00:02.000Z")).toBeLessThan(
      githubPages!.indexOf("2026-03-28T10:00:04.000Z"),
    );

    const githubJsonl = byFilename.get(`recordings/${safeSessionId}/pages/github.com.jsonl`);
    expect(githubJsonl).toBeDefined();
    const githubJsonlLines = githubJsonl!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(githubJsonlLines).toHaveLength(2);
    expect(githubJsonlLines[0]).toMatchObject({
      sessionId,
      tabId: 11,
      url: "https://github.com/org/repo?token=%5BREDACTED%5D",
    });
    expect(Array.isArray(githubJsonlLines[0].sections)).toBe(true);

    const jiraRequests = byFilename.get(
      `recordings/${safeSessionId}/requests/jira.example.com.txt`,
    );
    expect(jiraRequests).toBeDefined();
    expect(jiraRequests).toContain("# Host: jira.example.com");
    expect(jiraRequests).toContain("requestCount: 1");
    expect(jiraRequests).toContain("method: POST");
    expect(jiraRequests).toContain("url: https://jira.example.com/rest/api/3/search");

    const metadata = byFilename.get(`recordings/${safeSessionId}/session-metadata.json`);
    expect(metadata).toBeDefined();
    expect(JSON.parse(metadata!)).toMatchObject({
      sessionId,
      startedAt: "2026-03-28T09:59:59.000Z",
      stoppedAt: "2026-03-28T10:01:00.000Z",
      exportedAt: "2026-03-28T10:01:01.000Z",
      pageCount: 4,
      requestCount: 3,
      hostCount: 3,
      storageBytesInUse: 5_120,
    });

    expect(result).toEqual({
      sessionId,
      pageCount: 4,
      requestCount: 3,
      droppedPageCount: 0,
      droppedRequestCount: 0,
      hostCount: 3,
    });
  });
});
