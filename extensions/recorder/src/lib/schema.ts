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
  /** Stores 2+3 and sidecars — output (merged graphs + ledger + site metadata + request log). */
  storageBytesProcessed: number;
  /** When force-stop fired for size limit. */
  forceStoppedForLimit?: boolean;
  /** UI/runtime gate: output currently at or above start limit. */
  recordingBlockedForLimit?: boolean;
};

export type RecorderSettings = {
  pollIntervalMs: number;
  /** Max bytes for stores 2+3 (output) before forcing stop. */
  limitForceStopMb: number;
};

export type SessionStats = {
  urlCount: number;
  snapshotCount: number;
  storageBytesRaw: number;
  storageBytesProcessed: number;
  storageBytesTotal: number;
};

export type ExportMessage =
  | { type: "GET_STATE" }
  | { type: "GET_SESSION_STATS" }
  | { type: "GET_SETTINGS" }
  | { type: "UPDATE_SETTINGS"; payload: Partial<RecorderSettings> }
  | { type: "START_RECORDING" }
  | { type: "STOP_RECORDING" }
  | { type: "EXPORT_SESSION" }
  /** Partial clear: oldest snapshots until output (stores 2+3) is about half current size. */
  | { type: "CLEAR_TRIM" }
  /** Wipe stores 1–3 and digest queue. */
  | { type: "CLEAR_FULL" };
