// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  listProcessedForExport,
  mergeTreeIntoGraphAndLedger,
  resetMemoryStores,
} from "../../../src/lib/db";
import { buildZipEntriesFromProcessed } from "../../../src/lib/recorder-export";
import {
  buildCaptureTextTree,
  compressTextTree,
  htmlToTextTree,
} from "../../../src/lib/html-text-tree";
import { graphToDFSIndentedText, mergeTextTreeIntoGraph } from "../../../src/lib/merged-text-graph";

const fixturesDir = resolve(process.cwd(), "extensions/recorder/tests/fixtures");

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf8");
}

function wrapDocument(fragment: string): string {
  return `<!doctype html><html><body>${fragment}</body></html>`;
}

async function textFromLegacyTree(rawHtml: string): Promise<string> {
  const tree = compressTextTree(htmlToTextTree(rawHtml));
  const merged = await mergeTextTreeIntoGraph(null, tree, 1);
  return graphToDFSIndentedText(merged.graph);
}

async function textFromCaptureTree(rawHtml: string): Promise<string> {
  const tree = buildCaptureTextTree(rawHtml);
  const merged = await mergeTextTreeIntoGraph(null, tree, 1);
  return graphToDFSIndentedText(merged.graph);
}

beforeEach(() => {
  resetMemoryStores();
});

describe("capture tree pipeline", () => {
  it("keeps SPA shell output empty when there is no visible text", async () => {
    const rawHtml = wrapDocument('<div id="root"></div>');
    const legacyText = await textFromLegacyTree(rawHtml);
    const captureText = await textFromCaptureTree(rawHtml);

    expect(legacyText).toBe("");
    expect(captureText).toBe("");
  });

  it("extracts readable text from noisy feed card markup", async () => {
    const rawHtml = wrapDocument(readFixture("feed-card-single-post.html"));
    const text = await textFromCaptureTree(rawHtml);

    expect(text).toContain("Feed post");
    expect(text).toContain("Alex Morgan");
    expect(text).toContain("practical AI workflows");
    expect(text).toContain("Back in the industry after a break.");
  });

  it("extracts readable nested content from feed card with comments", async () => {
    const rawHtml = wrapDocument(readFixture("feed-card-with-comments-thread.html"));
    const text = await textFromCaptureTree(rawHtml);

    expect(text).toContain("Jordan Lee");
    expect(text).toContain("likes this");
    expect(text).toContain("Alex Morgan");
    expect(text).toContain("Back in tech recruiting this week.");
    expect(text).toContain("Casey Nguyen");
    expect(text).toContain("Curious how this compares to product X and product Y?");
    expect(text).toContain("I tested both and found this setup needed less retuning");
    expect(text).toContain("Load more comments");
    expect(text).toContain("\t");
  });

  it("builds non-empty export entries from fixture-driven processed rows", async () => {
    const fixtureA = wrapDocument(readFixture("feed-card-single-post.html"));
    const fixtureB = wrapDocument(readFixture("feed-card-with-comments-thread.html"));

    await mergeTreeIntoGraphAndLedger(
      "https://www.linkedin.com/feed/post-a",
      "snapshot-a",
      buildCaptureTextTree(fixtureA),
    );
    await mergeTreeIntoGraphAndLedger(
      "https://www.linkedin.com/feed/post-b",
      "snapshot-b",
      buildCaptureTextTree(fixtureB),
    );

    const processedRows = await listProcessedForExport();
    const entries = buildZipEntriesFromProcessed(processedRows);

    expect(entries).toHaveLength(1);
    expect(entries[0].filename).toBe("recorder/content/www-linkedin-com.txt");
    expect(entries.every((entry) => entry.content.trim().length > 0)).toBe(true);
  });
});
