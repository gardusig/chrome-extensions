const DEFAULT_COMPRESSION_RATIO = 0.35;
const MIN_COMPRESSION_RATIO = 0.1;
const MAX_COMPRESSION_RATIO = 0.95;

export function estimateCompressedBytes(totalBytes: number): number {
  const clamped = Math.max(0, totalBytes);
  const estimated = Math.round(clamped * DEFAULT_COMPRESSION_RATIO);
  return Math.max(0, estimated);
}

export function ratioFromSizes(originalBytes: number, compressedBytes: number): number {
  if (originalBytes <= 0 || compressedBytes < 0) {
    return DEFAULT_COMPRESSION_RATIO;
  }
  const ratio = compressedBytes / originalBytes;
  return Math.min(MAX_COMPRESSION_RATIO, Math.max(MIN_COMPRESSION_RATIO, ratio));
}
