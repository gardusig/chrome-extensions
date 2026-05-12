import { beforeEach, describe, expect, it } from "vitest";
import {
  deletePolledStagingByDigest,
  estimateBytesStore1,
  evictRawUntilUnderBudget,
  memoryStoresSnapshot,
  resetMemoryStores,
  tryPutPolledUnique,
} from "../../src/lib/db";
import { sha256Hex } from "../../src/lib/sha256";

beforeEach(() => {
  resetMemoryStores();
});

describe("raw staging delete + eviction (memory)", () => {
  it("evictRawUntilUnderBudget removes oldest by capturedAt then digest", async () => {
    const html1 = "<html><body>1</body></html>";
    const html2 = "<html><body>2</body></html>";
    const html3 = "<html><body>3</body></html>";
    const d1 = await sha256Hex(html1);
    const d2 = await sha256Hex(html2);
    const d3 = await sha256Hex(html3);

    await tryPutPolledUnique({
      digest: d1,
      rawHtml: html1,
      fullUrl: "https://ex.test/1",
      title: "1",
      capturedAt: "2026-05-10T10:00:00.000Z",
      tabId: 1,
      windowId: 1,
    });
    await tryPutPolledUnique({
      digest: d2,
      rawHtml: html2,
      fullUrl: "https://ex.test/2",
      title: "2",
      capturedAt: "2026-05-10T11:00:00.000Z",
      tabId: 1,
      windowId: 1,
    });
    await tryPutPolledUnique({
      digest: d3,
      rawHtml: html3,
      fullUrl: "https://ex.test/3",
      title: "3",
      capturedAt: "2026-05-10T12:00:00.000Z",
      tabId: 1,
      windowId: 1,
    });

    const evicted = await evictRawUntilUnderBudget(0);
    expect(evicted).toEqual([d1, d2, d3]);
    expect(memoryStoresSnapshot().polled).toHaveLength(0);
  });

  it("evictRawUntilUnderBudget tie-breaks same capturedAt by digest", async () => {
    const t = "2026-05-10T12:00:00.000Z";
    const htmlX = "<html><body>tie-x</body></html>";
    const htmlY = "<html><body>tie-y</body></html>";
    const dX = await sha256Hex(htmlX);
    const dY = await sha256Hex(htmlY);
    const [first, second] = [dX, dY].sort((a, b) => a.localeCompare(b));

    await tryPutPolledUnique({
      digest: dX,
      rawHtml: htmlX,
      fullUrl: "https://ex.test/x",
      title: "x",
      capturedAt: t,
      tabId: 1,
      windowId: 1,
    });
    await tryPutPolledUnique({
      digest: dY,
      rawHtml: htmlY,
      fullUrl: "https://ex.test/y",
      title: "y",
      capturedAt: t,
      tabId: 1,
      windowId: 1,
    });

    const evicted = await evictRawUntilUnderBudget(0);
    expect(evicted).toEqual([first, second]);
  });

  it("deletePolledStagingByDigest removes one digest from store 1", async () => {
    const html = "<html><body>x</body></html>";
    const digest = await sha256Hex(html);
    await tryPutPolledUnique({
      digest,
      rawHtml: html,
      fullUrl: "https://ex.test/x",
      title: "x",
      capturedAt: "2026-05-10T00:00:00.000Z",
      tabId: 1,
      windowId: 1,
    });
    expect(memoryStoresSnapshot().polled).toHaveLength(1);
    await deletePolledStagingByDigest(digest);
    expect(memoryStoresSnapshot().polled).toHaveLength(0);
    expect(await estimateBytesStore1()).toBe(0);
  });
});
