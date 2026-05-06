// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  buildSiteMetadataLines,
  buildSnapshotBlockText,
  formatRequestSummaryLines,
} from "../../src/lib/snapshot-block";

describe("tree → snapshot text", () => {
  it("produces page_metadata and indented page_content from a tree snapshot", () => {
    const block = buildSnapshotBlockText({
      fullUrl: "https://example.com/",
      capturedAt: "2026-05-05T12:00:00.000Z",
      tabId: 1,
      windowId: 2,
      title: "T",
      tree: {
        text: "",
        children: [{ text: "Post A", children: [{ text: "Hello world", children: [] }] }],
      },
    });
    expect(block).toContain("page_metadata:");
    expect(block).toContain("page_content:");
    expect(block).toContain("https://example.com/");
    expect(block).toContain("Post A");
    expect(block).toContain("-- Hello world");
    expect(block.length).toBeGreaterThan(40);
  });

  it("builds metadata lines and request summaries for site-level files", () => {
    const rawHtml = `<html><body><a href="/in/example">Profile</a><div>Hello</div></body></html>`;
    const metadataLines = buildSiteMetadataLines({
      fullUrl: "https://www.linkedin.com/feed/",
      headMeta: { title: "Feed" },
      rawHtml,
      title: "Feed",
    });
    const requestLines = formatRequestSummaryLines([
      {
        method: "GET",
        url: "https://www.linkedin.com/voyager/api/feed",
        requestPayloadBytes: null,
        responseStatus: 200,
        responseBytes: 1234,
        responseContentType: "application/json",
      },
    ]);

    expect(metadataLines.join("\n")).toContain("relatedLinks:");
    expect(metadataLines.join("\n")).toContain("https://www.linkedin.com/in/example");
    expect(requestLines.join("\n")).toContain("requests:");
    expect(requestLines.join("\n")).toContain("method: GET");
    expect(requestLines.join("\n")).toContain("responseStatus: 200");
  });
});
