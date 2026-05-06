import { beforeEach, describe, expect, it } from "vitest";
import {
  mergeTreeIntoGraphAndLedger,
  appendSiteRequestLog,
  countLedgerRows,
  clearAllStores,
  clearPolledUniqueStore,
  estimateTrimPlanToTargetBytes,
  estimateBytesStores23,
  listSiteMetadataForExport,
  mergeSiteMetadataLines,
  memoryStoresSnapshot,
  resetMemoryStores,
  tryPutPolledUnique,
  trimStores23ToTargetBytes,
} from "../../../src/lib/db";

beforeEach(() => {
  resetMemoryStores();
});

describe("db memory fallback", () => {
  const tree = { text: "", children: [{ text: "root", children: [] }] };

  it("dedupes polled rows by digest", async () => {
    const row = {
      digest: "abc",
      rawHtml: "<html></html>",
      fullUrl: "https://example.com/",
      title: "t",
      capturedAt: new Date().toISOString(),
      tabId: 1,
      windowId: 2,
    };
    expect(await tryPutPolledUnique(row)).toBe(true);
    expect(await tryPutPolledUnique(row)).toBe(false);
  });

  it("trim removes oldest ledger rows until under byte budget", async () => {
    const hugeTree = { text: "", children: [{ text: "x".repeat(5000), children: [] }] };
    await mergeTreeIntoGraphAndLedger("https://a.test/", "s1", hugeTree);
    await mergeTreeIntoGraphAndLedger("https://a.test/", "s2", hugeTree);
    const before = await estimateBytesStores23();
    expect(before).toBeGreaterThan(1000);
    await trimStores23ToTargetBytes(500);
    const after = await estimateBytesStores23();
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeLessThan(before);
  });

  it("estimates trim plan without mutating stores", async () => {
    const hugeTree = { text: "", children: [{ text: "x".repeat(5000), children: [] }] };
    await mergeTreeIntoGraphAndLedger("https://a.test/", "s1", hugeTree);
    await mergeTreeIntoGraphAndLedger("https://a.test/", "s2", hugeTree);
    const before = await estimateBytesStores23();
    const plan = await estimateTrimPlanToTargetBytes(before - 1000);
    expect(plan.snapshotsToRemove).toBeGreaterThan(0);
    expect(plan.estimatedBytesFreed).toBeGreaterThan(0);
    expect(await estimateBytesStores23()).toBe(before);
  });

  it("clears all stores", async () => {
    await tryPutPolledUnique({
      digest: "d",
      rawHtml: "<b></b>",
      fullUrl: "https://z/",
      title: "",
      capturedAt: new Date().toISOString(),
      tabId: 0,
      windowId: 0,
    });
    await mergeTreeIntoGraphAndLedger("https://z/", "id", tree);
    await clearAllStores();
    expect(await estimateBytesStores23()).toBe(0);
  });

  it("counts ingests via ledger rows", async () => {
    await mergeTreeIntoGraphAndLedger("https://a.test/", "s1", tree);
    await mergeTreeIntoGraphAndLedger("https://a.test/", "s2", tree);
    expect(await countLedgerRows()).toBe(2);
  });

  it("clears raw polled rows only", async () => {
    await tryPutPolledUnique({
      digest: "d2",
      rawHtml: "<b>2</b>",
      fullUrl: "https://z/",
      title: "",
      capturedAt: new Date().toISOString(),
      tabId: 0,
      windowId: 0,
    });
    await clearPolledUniqueStore();
    expect(memoryStoresSnapshot().polled.length).toBe(0);
  });

  it("creates URL graph from empty db on first merge", async () => {
    await mergeTreeIntoGraphAndLedger("https://example.com/a", "s1", {
      text: "",
      children: [{ text: "A", children: [{ text: "B", children: [] }] }],
    });
    const snap = memoryStoresSnapshot();
    expect(snap.processed).toHaveLength(1);
    const row = snap.processed[0];
    expect(Object.keys(row.graph.vertices).length).toBeGreaterThan(0);
    expect(row.graph.childrenByParent.__root__.length).toBeGreaterThan(0);
  });

  it("adds new subtree edges under an existing parent", async () => {
    await mergeTreeIntoGraphAndLedger("https://example.com/thread", "s1", {
      text: "",
      children: [{ text: "Thread", children: [{ text: "hello", children: [] }] }],
    });
    const first = memoryStoresSnapshot().processed[0].graph;
    const rootId = first.childrenByParent.__root__[0];
    const firstCount = (first.childrenByParent[rootId] ?? []).length;

    await mergeTreeIntoGraphAndLedger("https://example.com/thread", "s2", {
      text: "",
      children: [
        {
          text: "Thread",
          children: [
            { text: "hello", children: [] },
            { text: "new", children: [] },
          ],
        },
      ],
    });
    const second = memoryStoresSnapshot().processed[0].graph;
    const secondCount = (second.childrenByParent[rootId] ?? []).length;
    expect(secondCount).toBeGreaterThan(firstCount);
  });

  it("merges metadata lines per origin as a deduped set", async () => {
    await mergeSiteMetadataLines("https://www.linkedin.com", [
      "title: Feed",
      "document_title: Feed",
      "title: Feed",
    ]);
    await mergeSiteMetadataLines("https://www.linkedin.com", [
      "meta[name=viewport]: width=device-width",
    ]);
    const rows = await listSiteMetadataForExport();
    expect(rows).toHaveLength(1);
    expect(rows[0].lines).toEqual([
      "document_title: Feed",
      "meta[name=viewport]: width=device-width",
      "title: Feed",
    ]);
  });

  it("caps request logs per origin", async () => {
    await appendSiteRequestLog(
      "https://www.linkedin.com",
      { at: "2026-05-05T12:00:00.000Z", url: "https://www.linkedin.com/a", method: "GET" },
      2,
    );
    await appendSiteRequestLog(
      "https://www.linkedin.com",
      { at: "2026-05-05T12:01:00.000Z", url: "https://www.linkedin.com/b", method: "GET" },
      2,
    );
    await appendSiteRequestLog(
      "https://www.linkedin.com",
      { at: "2026-05-05T12:02:00.000Z", url: "https://www.linkedin.com/c", method: "GET" },
      2,
    );
    const snapshot = memoryStoresSnapshot();
    expect(snapshot.siteRequests).toHaveLength(1);
    expect(snapshot.siteRequests[0].entries).toHaveLength(2);
    expect(snapshot.siteRequests[0].entries[0].url).toContain("/b");
    expect(snapshot.siteRequests[0].entries[1].url).toContain("/c");
  });
});
