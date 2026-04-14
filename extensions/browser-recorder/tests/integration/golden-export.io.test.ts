import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../src/lib/schema";
import { createChromeMock } from "../support/chrome-mocks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(__dirname, "../fixtures/golden-export");

async function loadBackgroundWithHooks(seed: Record<string, unknown> = {}): Promise<{
  hooks: (typeof import("../../src/background"))["__testHooks"];
}> {
  const chromeMock = createChromeMock(seed);
  globalThis.chrome = chromeMock;
  vi.resetModules();
  const module = await import("../../src/background");
  return { hooks: module.__testHooks };
}

function bodyTextFromFixtureHtml(html: string): string {
  const dom = new JSDOM(html);
  const raw = dom.window.document.body?.textContent ?? "";
  return raw.trim();
}

describe("golden export I/O (HTML fixtures → zip text entries)", () => {
  it("matches expected page .txt for duplicate GitHub-like snapshots (body + semantic compaction)", async () => {
    const html = readFileSync(join(goldenDir, "github-actions-mock.html"), "utf8");
    const bodyInner = bodyTextFromFixtureHtml(html);

    const semanticLine = "[source=semantic selector=a kind=aria-label]\nInsights";
    const textContent = `[source=body selector=body]\n${bodyInner}\n\n${semanticLine}`;

    const { hooks } = await loadBackgroundWithHooks({
      [STORAGE_KEYS.pages]: "not-array",
      [STORAGE_KEYS.requests]: [],
    });

    const row = (id: string, timestamp: string) => ({
      id,
      createdAt: timestamp,
      tabId: 1,
      windowId: 1,
      url: "https://github.com/example/repo/actions",
      urlPrefix: "github.com",
      title: "Actions",
      reason: "poll-diff",
      timestamp,
      textContent,
      signatureHash: 1,
      sectionCount: 1,
      contentSizeBytes: 100,
    });

    const result = hooks.buildUrlTextEntriesWithCompaction([
      row("snap-a", "2026-04-03T10:00:01.000Z"),
      row("snap-b", "2026-04-03T10:00:02.000Z"),
    ]);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.filename).toBe(
      "pages/github.com/https___github.com_example_repo_actions.txt",
    );

    const expected = readFileSync(join(goldenDir, "expected-github-actions-export.txt"), "utf8");
    expect(result.entries[0]?.content).toBe(expected);

    expect(result.compaction).toEqual({
      semanticChunksRaw: 2,
      semanticChunksOmitted: 1,
      snapshotsCompacted: 1,
      bodyBlocksRaw: 2,
      bodyBlocksOmitted: 1,
      snapshotsBodyCompacted: 1,
    });
  });
});
