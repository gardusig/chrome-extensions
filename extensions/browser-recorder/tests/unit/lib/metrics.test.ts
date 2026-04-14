import { describe, expect, it } from "vitest";
import {
  effectiveSizeBytes,
  estimateCompressedBytes,
  ratioFromSizes,
} from "../../../src/lib/metrics";

describe("metrics helpers", () => {
  it("estimates compressed bytes from clamped total size", () => {
    expect(estimateCompressedBytes(1_000)).toBe(385);
    expect(estimateCompressedBytes(-100)).toBe(0);
  });

  it("uses midpoint between raw and compressed estimate for effective size", () => {
    expect(effectiveSizeBytes(1_000)).toBe(693);
    expect(effectiveSizeBytes(0)).toBe(0);
  });

  it("returns bounded ratio from original and compressed sizes", () => {
    expect(ratioFromSizes(0, 10)).toBe(0.35);
    expect(ratioFromSizes(100, -1)).toBe(0.35);
    expect(ratioFromSizes(100, 1)).toBe(0.1);
    expect(ratioFromSizes(100, 97)).toBe(0.95);
    expect(ratioFromSizes(100, 35)).toBe(0.35);
  });
});
