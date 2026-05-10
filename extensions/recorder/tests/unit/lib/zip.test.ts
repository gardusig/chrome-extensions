import { describe, expect, it } from "vitest";
import { createZip } from "../../../src/lib/zip";

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

describe("createZip", () => {
  it("keeps DOS header timestamps zeroed (1980 display in unzip tools)", () => {
    const zip = createZip([
      { filename: "pages/github.com/example.txt", content: "hello" },
      { filename: "metadata.json", content: '{"ok":true}' },
    ]);

    // First local file header starts at byte 0.
    expect(readU32LE(zip, 0)).toBe(0x04034b50);
    expect(readU16LE(zip, 10)).toBe(0); // mod time
    expect(readU16LE(zip, 12)).toBe(0); // mod date

    // First central directory header follows local headers + file bytes.
    const firstLocalNameLength = readU16LE(zip, 26);
    const firstLocalDataSize = readU32LE(zip, 18);
    const secondLocalOffset = 30 + firstLocalNameLength + firstLocalDataSize;
    const secondLocalNameLength = readU16LE(zip, secondLocalOffset + 26);
    const secondLocalDataSize = readU32LE(zip, secondLocalOffset + 18);
    const firstCentralOffset = secondLocalOffset + 30 + secondLocalNameLength + secondLocalDataSize;

    expect(readU32LE(zip, firstCentralOffset)).toBe(0x02014b50);
    expect(readU16LE(zip, firstCentralOffset + 12)).toBe(0); // mod time
    expect(readU16LE(zip, firstCentralOffset + 14)).toBe(0); // mod date
  });
});
