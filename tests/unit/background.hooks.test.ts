import { describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../src/lib/schema";
import { createChromeMock } from "../support/chrome-mocks";

type BackgroundModule = typeof import("../../src/background");

async function loadBackgroundWithHooks(seed: Record<string, unknown> = {}): Promise<{
  module: BackgroundModule;
}> {
  const chromeMock = createChromeMock(seed);
  globalThis.chrome = chromeMock;
  vi.resetModules();
  const module = await import("../../src/background");
  return { module };
}

describe("background test hooks", () => {
  it("covers core utility hooks", async () => {
    const { module } = await loadBackgroundWithHooks({
      [STORAGE_KEYS.pages]: "not-array",
      [STORAGE_KEYS.requests]: [],
    });
    const hooks = module.__testHooks;

    expect(hooks.parseRecordTimestamp("invalid")).toBe(Number.MAX_SAFE_INTEGER);
    expect(hooks.parseRecordTimestamp("2026-03-28T00:00:00.000Z")).toBeGreaterThan(0);
    expect(hooks.isCapturableUrl(undefined)).toBe(false);
    expect(hooks.isCapturableUrl("chrome://extensions")).toBe(false);
    expect(hooks.isCapturableUrl("https://github.com")).toBe(true);

    hooks.resetSnapshotStateForSession();
    const hashOne = hooks.snapshotSignatureHash({
      url: "https://github.com",
      title: "GitHub",
      textContent: "hello world",
    });
    const hashTwo = hooks.snapshotSignatureHash({
      url: "https://github.com",
      title: "GitHub",
      textContent: "hello world updated",
    });
    expect(hooks.shouldAppendSnapshot(1, hashOne, 1_000, "poll-diff")).toBe(true);
    expect(hooks.shouldAppendSnapshot(1, hashOne, 1_050, "poll-diff")).toBe(false);
    expect(hooks.shouldAppendSnapshot(1, hashTwo, 1_400, "poll-diff")).toBe(true);
  });
});
