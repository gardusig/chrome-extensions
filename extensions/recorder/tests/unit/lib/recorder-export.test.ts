import { describe, expect, it } from "vitest";
import {
  buildZipEntriesFromProcessed,
  buildZipEntriesFromSiteMetadata,
  buildZipEntriesFromSiteRequests,
  exportZipBasename,
  siteFolderFromUrl,
  slugFromUrl,
} from "../../../src/lib/recorder-export";

describe("recorder-export paths", () => {
  it("builds site folder and slug", () => {
    expect(siteFolderFromUrl("https://www.EXAMPLE.com/foo/bar")).toBe("www-example-com");
    expect(slugFromUrl("https://www.example.com/foo/bar")).toContain("www-example-com");
  });

  it("formats zip basename with filesystem-safe timestamp", () => {
    const fixed = new Date(Date.UTC(2026, 4, 5, 14, 30, 0));
    expect(exportZipBasename(fixed)).toBe("recorder-session-2026-05-05T14-30-00.zip");
  });

  it("builds zip entries from processed rows", () => {
    const entries = buildZipEntriesFromProcessed([
      {
        fullUrl: "https://example.com/page",
        graph: {
          vertices: {
            a: { depth: 0, text: "a", introducedLedgerSeq: 1 },
            b: { depth: 1, text: "b", introducedLedgerSeq: 1 },
          },
          childrenByParent: { __root__: ["a"], a: ["b"] },
        },
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].filename.startsWith("example-com/")).toBe(true);
    expect(entries[0].content).toContain("a");
    expect(entries[0].content).toContain("\tb");
  });

  it("builds sidecar metadata and request files per site", () => {
    const metadata = buildZipEntriesFromSiteMetadata([
      { origin: "https://www.linkedin.com", lines: ["title: Feed", "html_lang: en-US"] },
    ]);
    const requests = buildZipEntriesFromSiteRequests([
      {
        origin: "https://www.linkedin.com",
        entries: [
          { at: "2026-05-05T12:00:00.000Z", url: "https://www.linkedin.com/feed", method: "GET" },
        ],
      },
    ]);
    expect(metadata[0].filename).toBe("www-linkedin-com/site-metadata.txt");
    expect(metadata[0].content).toContain("title: Feed");
    expect(requests[0].filename).toBe("www-linkedin-com/site-requests.jsonl");
    expect(requests[0].content).toContain('"method":"GET"');
  });
});
