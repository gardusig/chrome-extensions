import { beforeEach, describe, expect, it } from "vitest";
import {
  appendSnapshotAndLedger,
  clearAllStores,
  clearPolledUniqueStore,
  estimateTrimPlanToTargetBytes,
  estimateBytesStores23,
  memoryStoresSnapshot,
  resetMemoryStores,
  tryPutPolledUnique,
  trimStores23ToTargetBytes,
} from "../../../src/lib/db";

beforeEach(() => {
  resetMemoryStores();
});

describe("db memory fallback", () => {
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
    const huge = "x".repeat(5000);
    await appendSnapshotAndLedger("https://a.test/", "s1", huge);
    await appendSnapshotAndLedger("https://a.test/", "s2", huge);
    const before = await estimateBytesStores23();
    expect(before).toBeGreaterThan(1000);
    await trimStores23ToTargetBytes(500);
    const after = await estimateBytesStores23();
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeLessThan(before);
  });

  it("estimates trim plan without mutating stores", async () => {
    const huge = "x".repeat(5000);
    await appendSnapshotAndLedger("https://a.test/", "s1", huge);
    await appendSnapshotAndLedger("https://a.test/", "s2", huge);
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
    await appendSnapshotAndLedger("https://z/", "id", "snap");
    await clearAllStores();
    expect(await estimateBytesStores23()).toBe(0);
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
});
