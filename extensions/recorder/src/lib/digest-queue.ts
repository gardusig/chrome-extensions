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
