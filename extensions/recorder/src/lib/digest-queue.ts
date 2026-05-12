/** In-memory FIFO of content digests pending worker consumption (not persisted). */
const fifo: string[] = [];

export function pushDigest(digestHex: string): void {
  fifo.push(digestHex);
}

export function popDigest(): string | undefined {
  return fifo.shift();
}

export function clearDigestQueue(): void {
  fifo.length = 0;
}

export function digestQueueLength(): number {
  return fifo.length;
}

/** Copy for tests / diagnostics */
export function peekDigestQueue(): readonly string[] {
  return [...fifo];
}

/** Remove every occurrence of `digestHex` from the FIFO (eviction / DB delete). */
export function removeDigestIfPresent(digestHex: string): void {
  for (let i = fifo.length - 1; i >= 0; i -= 1) {
    if (fifo[i] === digestHex) {
      fifo.splice(i, 1);
    }
  }
}
