import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "../support/chrome-mocks";

vi.mock("../../src/lib/db", () => ({
  appendSnapshotAndLedger: vi.fn(async () => undefined),
  clearAllStores: vi.fn(async () => undefined),
  clearPolledUniqueStore: vi.fn(async () => undefined),
  estimateTrimPlanToTargetBytes: vi.fn(async () => ({
    snapshotsToRemove: 0,
    estimatedBytesFreed: 0,
    projectedBytesAfter: 0,
  })),
  estimateBytesStore1: vi.fn(async () => 0),
  estimateBytesStores23: vi.fn(async () => 40 * 1024 * 1024),
  getPolledUnique: vi.fn(async () => null),
  listProcessedForExport: vi.fn(async () => []),
  trimStores23ToTargetBytes: vi.fn(async () => 0),
  tryPutPolledUnique: vi.fn(async () => true),
}));

vi.mock("../../src/lib/sha256", () => ({
  sha256Hex: vi.fn(async () => "digest"),
}));

describe("background start gating", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects START_RECORDING when processed output is above limit", async () => {
    const chromeMock = createChromeMock({
      "recorder:settings": { pollIntervalMs: 500, limitForceStopMb: 32, targetAfterCleanupMb: 16 },
    });
    vi.stubGlobal("chrome", chromeMock);

    await import("../../src/background");

    const runtimeListener = (
      chromeMock as unknown as {
        __runtimeListeners: Array<
          (
            message: unknown,
            sender: chrome.runtime.MessageSender,
            sendResponse: (response?: unknown) => void,
          ) => boolean | void
        >;
      }
    ).__runtimeListeners.at(-1);
    expect(runtimeListener).toBeDefined();

    const response = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      runtimeListener?.({ type: "START_RECORDING" }, {}, (value) =>
        resolve(value as { ok: boolean; error?: string }),
      );
    });

    expect(response.ok).toBe(false);
    expect(response.error).toContain("above limit");
  });
});
