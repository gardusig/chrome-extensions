type ZipEntryInput = {
  filename: string;
  content: string;
};

type EncodedEntry = {
  filename: string;
  filenameBytes: Uint8Array;
  data: Uint8Array;
  crc32: number;
  offset: number;
};

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let j = 0; j < 8; j += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

export function createZip(entries: ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const encoded: EncodedEntry[] = entries.map((entry) => {
    const safeFilename = entry.filename.replaceAll("\\", "/");
    const filenameBytes = encoder.encode(safeFilename);
    const data = encoder.encode(entry.content);
    return {
      filename: safeFilename,
      filenameBytes,
      data,
      crc32: crc32(data),
      offset: 0,
    };
  });

  const localParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of encoded) {
    entry.offset = offset;
    const header = new Uint8Array(30 + entry.filenameBytes.length);
    const view = new DataView(header.buffer);
    writeU32(view, 0, 0x04034b50);
    writeU16(view, 4, 20);
    writeU16(view, 6, 0);
    writeU16(view, 8, 0);
    writeU16(view, 10, 0);
    writeU16(view, 12, 0);
    writeU32(view, 14, entry.crc32);
    writeU32(view, 18, entry.data.length);
    writeU32(view, 22, entry.data.length);
    writeU16(view, 26, entry.filenameBytes.length);
    writeU16(view, 28, 0);
    header.set(entry.filenameBytes, 30);
    localParts.push(header, entry.data);
    offset += header.length + entry.data.length;
  }

  const centralParts: Uint8Array[] = [];
  let centralSize = 0;
  for (const entry of encoded) {
    const central = new Uint8Array(46 + entry.filenameBytes.length);
    const view = new DataView(central.buffer);
    writeU32(view, 0, 0x02014b50);
    writeU16(view, 4, 20);
    writeU16(view, 6, 20);
    writeU16(view, 8, 0);
    writeU16(view, 10, 0);
    writeU16(view, 12, 0);
    writeU16(view, 14, 0);
    writeU32(view, 16, entry.crc32);
    writeU32(view, 20, entry.data.length);
    writeU32(view, 24, entry.data.length);
    writeU16(view, 28, entry.filenameBytes.length);
    writeU16(view, 30, 0);
    writeU16(view, 32, 0);
    writeU16(view, 34, 0);
    writeU16(view, 36, 0);
    writeU32(view, 38, 0);
    writeU32(view, 42, entry.offset);
    central.set(entry.filenameBytes, 46);
    centralParts.push(central);
    centralSize += central.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeU32(endView, 0, 0x06054b50);
  writeU16(endView, 4, 0);
  writeU16(endView, 6, 0);
  writeU16(endView, 8, encoded.length);
  writeU16(endView, 10, encoded.length);
  writeU32(endView, 12, centralSize);
  writeU32(endView, 16, offset);
  writeU16(endView, 20, 0);

  const totalSize =
    localParts.reduce((sum, part) => sum + part.length, 0) +
    centralParts.reduce((sum, part) => sum + part.length, 0) +
    end.length;
  const out = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of localParts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  out.set(end, cursor);
  return out;
}
