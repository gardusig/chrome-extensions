import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrichedPageRecord, QueueRecord, RawPageRecord } from "../../../src/lib/db";

type DbModule = typeof import("../../../src/lib/db");

function setIndexedDb(value: IDBFactory | undefined): void {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    writable: true,
    value,
  });
}

async function loadDbModule(): Promise<DbModule> {
  vi.resetModules();
  return import("../../../src/lib/db");
}

function makeRaw(id: string): RawPageRecord {
  return {
    id,
    createdAt: `2026-03-29T00:00:0${id}Z`,
    tabId: 1,
    windowId: 1,
    url: `https://example.com/${id}`,
    urlPrefix: "example.com",
    title: `Page ${id}`,
    reason: "test",
    textContent: `content-${id}`,
    htmlContent: `<html>${id}</html>`,
    signatureHash: Number(id),
    contentSizeBytes: 100 + Number(id),
  };
}

function makeQueue(id: string, dedupeKey: string): QueueRecord {
  return {
    id,
    rawId: id,
    createdAt: `2026-03-29T00:00:0${id}Z`,
    tabId: 1,
    urlPrefix: "example.com",
    dedupeKey,
    status: "pending",
    attempts: 0,
    lastUpdatedAt: `2026-03-29T00:00:0${id}Z`,
  };
}

function makeEnriched(id: string, timestamp: string): EnrichedPageRecord {
  return {
    id,
    createdAt: "2026-03-29T00:00:00.000Z",
    tabId: 1,
    windowId: 1,
    url: `https://example.com/${id}`,
    urlPrefix: "example.com",
    title: `Enriched ${id}`,
    reason: "processed",
    timestamp,
    textContent: `text-${id}`,
    htmlContent: `<html>${id}</html>`,
    sectionCount: 2,
    contentSizeBytes: 256,
  };
}

describe("db memory fallback", () => {
  beforeEach(() => {
    setIndexedDb(undefined);
  });

  it("processes queue lifecycle, dedupes pending records, and computes stats", async () => {
    const db = await loadDbModule();
    await db.clearAllCaptureData();

    const queue1 = makeQueue("1", "dedupe-a");
    expect(await db.addRawAndQueue(makeRaw("1"), queue1)).toEqual({
      accepted: true,
    });
    expect(await db.addRawAndQueue(makeRaw("2"), makeQueue("2", queue1.dedupeKey))).toEqual({
      accepted: false,
    });

    expect(await db.hasPendingQueueMessages()).toBe(true);

    const picked1 = await db.pollNextQueueRecord();
    expect(picked1?.id).toBe("1");
    expect(picked1?.status).toBe("processing");
    expect(picked1?.attempts).toBe(1);
    expect(await db.getRawPage("1")).not.toBeNull();

    await db.markQueueFailed("1", "pipeline failed");
    expect(await db.hasPendingQueueMessages()).toBe(false);

    const queue2 = makeQueue("2", "dedupe-a");
    expect(await db.addRawAndQueue(makeRaw("2"), queue2)).toEqual({
      accepted: true,
    });
    const picked2 = await db.pollNextQueueRecord();
    expect(picked2?.id).toBe("2");

    await db.acknowledgeProcessed("2", "2", makeEnriched("enriched-2", "2026-03-29T00:00:05.000Z"));
    expect(await db.getRawPage("2")).toBeNull();

    const enrichedRows = await db.listEnrichedPages();
    expect(enrichedRows).toHaveLength(1);
    expect(enrichedRows[0]?.id).toBe("enriched-2");

    const stats = await db.readPipelineStats((bytes) => Math.round(bytes * 0.5));
    expect(stats.queue).toEqual({
      pending: 0,
      processing: 0,
      failed: 1,
      processed: 1,
    });
    expect(stats.totals.rawCount).toBe(1);
    expect(stats.totals.enrichedCount).toBe(1);
    expect(stats.urlRows).toEqual([
      { url: "https://example.com/enriched-2", pageCount: 1, bytes: 256 },
    ]);

    await db.clearAllCaptureData();
    const afterClear = await db.readPipelineStats((bytes) => bytes);
    expect(afterClear.totals.rawCount).toBe(0);
    expect(afterClear.totals.enrichedCount).toBe(0);
  });

  it("handles empty and no-op operations safely", async () => {
    const db = await loadDbModule();
    await db.clearAllCaptureData();

    expect(await db.pollNextQueueRecord()).toBeNull();
    expect(await db.getRawPage("missing")).toBeNull();
    expect(await db.listEnrichedPages()).toEqual([]);

    await expect(db.markQueueFailed("missing", "no-op")).resolves.toBeUndefined();
  });
});
