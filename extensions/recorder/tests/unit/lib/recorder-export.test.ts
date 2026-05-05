import { describe, expect, it } from "vitest";
import {
  buildZipEntriesFromProcessed,
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
        snapshots: [
          { id: "1", text: "a" },
          { id: "2", text: "b" },
        ],
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].filename.startsWith("example-com/")).toBe(true);
    expect(entries[0].content).toContain("----------");
  });
});
