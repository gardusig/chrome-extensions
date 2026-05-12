// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as digestQueue from "../../src/lib/digest-queue";
import {
  deletePolledStagingByDigest,
  getPolledUnique,
  memoryStoresSnapshot,
  mergeSiteMetadataLines,
  mergeTreeIntoGraphAndLedger,
  originFromUrl,
  resetMemoryStores,
  tryPutPolledUnique,
} from "../../src/lib/db";
import { extractHeadMeta } from "../../src/lib/head-meta";
import { buildCaptureTextTree, treeToIndentedText } from "../../src/lib/html-text-tree";
import { graphToDFSIndentedText } from "../../src/lib/merged-text-graph";
import { sha256Hex } from "../../src/lib/sha256";
import { buildSiteMetadataLines } from "../../src/lib/snapshot-block";

const fixturesDir = resolve(process.cwd(), "extensions/recorder/tests/fixtures");

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf8");
}

function wrapDocument(fragment: string): string {
  return `<!doctype html><html><body>${fragment}</body></html>`;
}

async function enqueueRawCapture(input: {
  fullUrl: string;
  rawHtml: string;
  title: string;
}): Promise<string> {
  const digest = await sha256Hex(input.rawHtml);
  await tryPutPolledUnique({
    digest,
    rawHtml: input.rawHtml,
    fullUrl: input.fullUrl,
    title: input.title,
    capturedAt: "2026-05-09T00:00:00.000Z",
    tabId: 1,
    windowId: 1,
  });
  digestQueue.pushDigest(digest);
  return digest;
}

async function drainQueueLikeWorker(): Promise<void> {
  let snapshotSeq = 0;
  while (digestQueue.digestQueueLength() > 0) {
    const digest = digestQueue.popDigest();
    if (!digest) {
      break;
    }
    const row = await getPolledUnique(digest);
    if (!row) {
      continue;
    }
    const tree = buildCaptureTextTree(row.rawHtml);
    const headMeta = row.headMeta ?? extractHeadMeta(row.rawHtml);
    await mergeSiteMetadataLines(
      originFromUrl(row.fullUrl),
      buildSiteMetadataLines({
        fullUrl: row.fullUrl,
        headMeta,
        rawHtml: row.rawHtml,
        title: row.title,
      }),
    );
    snapshotSeq += 1;
    await mergeTreeIntoGraphAndLedger(row.fullUrl, `snapshot-${snapshotSeq}`, tree);
    await deletePolledStagingByDigest(digest);
  }
}

beforeEach(() => {
  resetMemoryStores();
  digestQueue.clearDigestQueue();
});

describe("capture raw HTML worker pipeline", () => {
  it("round-trips raw HTML from capture store to worker read path", async () => {
    const rawHtml = wrapDocument("<main><h1>Hello worker</h1><p>Readable line</p></main>");
    const digest = await enqueueRawCapture({
      fullUrl: "https://a.test/hello",
      rawHtml,
      title: "Hello worker",
    });
    const row = await getPolledUnique(digest);
    expect(row).not.toBeNull();
    expect(row?.rawHtml).toBe(rawHtml);
  });

  it("pops queue items and processes captures into graphs and metadata", async () => {
    await enqueueRawCapture({
      fullUrl: "https://a.test/page",
      rawHtml: wrapDocument("<main><h1>Alpha Site</h1></main>"),
      title: "Alpha",
    });
    await enqueueRawCapture({
      fullUrl: "https://b.test/page",
      rawHtml: wrapDocument("<main><h1>Beta Site</h1></main>"),
      title: "Beta",
    });

    await drainQueueLikeWorker();
    const snapshot = memoryStoresSnapshot();

    expect(digestQueue.digestQueueLength()).toBe(0);
    expect(snapshot.processed).toHaveLength(2);
    expect(snapshot.siteMetadata).toHaveLength(2);
    expect(snapshot.ledger).toHaveLength(2);
  });

  it("parses fixture HTML into readable text output", async () => {
    const rawHtml = wrapDocument(readFixture("feed-card-single-post.html"));
    const digest = await enqueueRawCapture({
      fullUrl: "https://www.linkedin.com/feed/update/urn:li:activity:1",
      rawHtml,
      title: "Feed post",
    });
    await drainQueueLikeWorker();

    expect(await getPolledUnique(digest)).toBeNull();
    const treeText = treeToIndentedText(buildCaptureTextTree(rawHtml)).trim();
    expect(treeText).toContain("Feed post");
    expect(treeText).toContain("Alex Morgan");
    expect(treeText).toContain("practical AI workflows");

    const snapshot = memoryStoresSnapshot();
    const processed = snapshot.processed[0];
    const graphText = graphToDFSIndentedText(processed.graph).trim();
    expect(graphText.length).toBeGreaterThan(0);
    expect(graphText).toContain("Back in the industry after a break.");
  });
});
