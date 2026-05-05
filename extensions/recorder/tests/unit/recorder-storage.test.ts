/**
 * §R-style scenarios: memory IDB + digest queue (same semantics as force-stop / stop).
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as digestQueue from "../../src/lib/digest-queue";
import {
  appendSnapshotAndLedger,
  clearAllStores,
  clearPolledUniqueStore,
  estimateBytesStores23,
  memoryStoresSnapshot,
  resetMemoryStores,
  tryPutPolledUnique,
  trimStores23ToTargetBytes,
} from "../../src/lib/db";
import { sha256Hex } from "../../src/lib/sha256";

beforeEach(() => {
  resetMemoryStores();
  digestQueue.clearDigestQueue();
});

describe("storage lifecycle (memory)", () => {
  it("after simulated stop: raw empty, output+ledger preserved", async () => {
    const html = "<html><head><title>x</title></head><body><p>hi</p></body></html>";
    const digest = await sha256Hex(html);
    await tryPutPolledUnique({
      digest,
      rawHtml: html,
      fullUrl: "https://ex.test/a",
      title: "x",
      capturedAt: new Date().toISOString(),
      tabId: 3,
      windowId: 4,
    });
    digestQueue.pushDigest(digest);
    await appendSnapshotAndLedger("https://ex.test/a", crypto.randomUUID(), "snap-text");

    const before = memoryStoresSnapshot();
    expect(before.polled.length).toBe(1);
    expect(before.processed.length).toBe(1);

    digestQueue.clearDigestQueue();
    await clearPolledUniqueStore();

    const after = memoryStoresSnapshot();
    expect(after.polled.length).toBe(0);
    expect(digestQueue.digestQueueLength()).toBe(0);
    expect(after.processed.length).toBe(1);
    expect(after.ledger.length).toBe(1);
  });

  it("trim partial removes oldest snapshots until budget", async () => {
    await appendSnapshotAndLedger("https://u/", "a", "x".repeat(4000));
    await appendSnapshotAndLedger("https://u/", "b", "y".repeat(4000));
    const removed = await trimStores23ToTargetBytes(3000);
    expect(removed).toBeGreaterThan(0);
    expect(await estimateBytesStores23()).toBeLessThanOrEqual(3000);
  });

  it("full clear wipes output and ledger", async () => {
    await appendSnapshotAndLedger("https://u/", "a", "txt");
    digestQueue.clearDigestQueue();
    await clearAllStores();
    const snap = memoryStoresSnapshot();
    expect(snap.processed.length).toBe(0);
    expect(snap.ledger.length).toBe(0);
  });
});
