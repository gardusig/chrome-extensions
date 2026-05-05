export const STORAGE_KEYS = {
  state: "recorder:state",
  settings: "recorder:settings",
} as const;

export type RecorderState = {
  isRecording: boolean;
  sessionId: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  /** Estimated bytes: stores 1+2+3 while recording; after stop: stores 2+3 only (raw cleared). */
  storageBytesTotal: number;
  /** Store 1 (`polled_unique`) — zero after stop. */
  storageBytesRaw: number;
  /** Stores 2+3 — processed output + ledger. */
  storageBytesProcessed: number;
  /** When force-stop fired for size limit. */
  forceStoppedForLimit?: boolean;
  /** UI/runtime gate: output+ledger currently at or above start limit. */
  recordingBlockedForLimit?: boolean;
};

export type RecorderSettings = {
  pollIntervalMs: number;
  /** Max bytes for stores 2+3 (processed snapshots + ledger) before forcing stop. */
  limitForceStopMb: number;
  /** Target max bytes for stores 2+3 after trim (partial clear). */
  targetAfterCleanupMb: number;
};

export type SessionStats = {
  urlCount: number;
  snapshotCount: number;
  storageBytesRaw: number;
  storageBytesProcessed: number;
  storageBytesTotal: number;
};

export type ClearSuggestion = {
  id: string;
  label: string;
  targetBytes: number;
  snapshotsToRemove: number;
  estimatedBytesFreed: number;
  projectedBytesAfter: number;
};

export type ExportMessage =
  | { type: "GET_STATE" }
  | { type: "GET_SESSION_STATS" }
  | { type: "GET_SETTINGS" }
  | { type: "UPDATE_SETTINGS"; payload: Partial<RecorderSettings> }
  | { type: "START_RECORDING" }
  | { type: "STOP_RECORDING" }
  | { type: "EXPORT_SESSION" }
  | { type: "GET_CLEAR_SUGGESTIONS" }
  /** Partial clear: oldest snapshots via ledger until under targetAfterCleanupMb (stores 2+3). */
  | { type: "CLEAR_TRIM" }
  | { type: "CLEAR_TRIM_TO_TARGET"; payload: { targetBytes: number } }
  /** Wipe stores 1–3 and digest queue. */
  | { type: "CLEAR_FULL" };
