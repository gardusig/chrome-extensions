// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildSnapshotBlockText } from "../../src/lib/snapshot-block";

describe("rawHtml → snapshot text", () => {
  it("produces page_metadata and indented page_content from minimal HTML", () => {
    const rawHtml =
      "<html><head><title>T</title></head><body><div><span>a</span></div></body></html>";
    const block = buildSnapshotBlockText({
      fullUrl: "https://example.com/",
      capturedAt: "2026-05-05T12:00:00.000Z",
      tabId: 1,
      windowId: 2,
      title: "T",
      headMeta: { title: "T" },
      rawHtml,
    });
    expect(block).toContain("page_metadata:");
    expect(block).toContain("page_content:");
    expect(block).toContain("https://example.com/");
    expect(block.length).toBeGreaterThan(40);
  });

  it("emits relatedLinks and requests metadata", () => {
    const rawHtml = `<html><body><a href="/in/example">Profile</a><div>Hello</div></body></html>`;
    const block = buildSnapshotBlockText({
      fullUrl: "https://www.linkedin.com/feed/",
      capturedAt: "2026-05-05T12:00:00.000Z",
      tabId: 9,
      windowId: 5,
      title: "Feed",
      headMeta: { title: "Feed" },
      rawHtml,
      requests: [
        {
          method: "GET",
          url: "https://www.linkedin.com/voyager/api/feed",
          requestPayloadBytes: null,
          responseStatus: 200,
          responseBytes: 1234,
          responseContentType: "application/json",
        },
      ],
    });

    expect(block).toContain("relatedLinks:");
    expect(block).toContain("https://www.linkedin.com/in/example");
    expect(block).toContain("requests:");
    expect(block).toContain("method: GET");
    expect(block).toContain("responseStatus: 200");
  });
});
