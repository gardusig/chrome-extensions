export const STORAGE_KEYS = {
  state: "recorder:state",
  pages: "recorder:pages",
  requests: "recorder:requests",
  settings: "recorder:settings",
  hostIndex: "recorder:host-index",
} as const;

export type RecorderState = {
  isRecording: boolean;
  isStopping?: boolean;
  sessionId: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  droppedPageCount: number;
  droppedRequestCount: number;
  storageBytesInUse: number;
};

export type PageSnapshotRecord = {
  id: string;
  sessionId: string;
  timestamp: string;
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  reason: string;
  textContent: string;
  htmlContent?: string;
};

export type RequestRecord = {
  id: string;
  sessionId: string;
  timestamp: string;
  tabId: number;
  windowId: number;
  type: string;
  method: string;
  url: string;
  initiator?: string;
};

export type HeaderRecord = {
  name: string;
  value?: string;
};

export type SessionStats = {
  sessionId: string | null;
  pageCount: number;
  droppedPageCount: number;
  requestCount: number;
  droppedRequestCount: number;
  hostCount: number;
  storageBytesInUse: number;
};

export type HostQueueStatsRow = {
  host: string;
  mapped: boolean;
  queueSize: number;
  workerActive: boolean;
};

export type HostQueueStats = {
  distinctHostCount: number;
  generatedAt: string;
  hosts: HostQueueStatsRow[];
};

export type PipelineStats = {
  queue: {
    pending: number;
    processing: number;
    failed: number;
    processed: number;
  };
  totals: {
    rawCount: number;
    enrichedCount: number;
    totalBytes: number;
    estimatedCompressedBytes: number;
  };
  urlPrefixRows: Array<{
    urlPrefix: string;
    pageCount: number;
    bytes: number;
  }>;
  generatedAt: string;
};

export type CapturePreset = "pages_only" | "pages_requests" | "full_capture";

export type RecorderSettings = {
  preset: CapturePreset;
  hardLimitMb: number;
  autoExportOnSoftLimit: boolean;
  pollIntervalMs: number;
  forceInitialScanOnStart: boolean;
  savePageText: boolean;
  savePageHtml: boolean;
  saveRequestData: boolean;
  savePageMeta: boolean;
};

export type ExportMessage =
  | { type: "GET_STATE" }
  | { type: "GET_SESSION_STATS" }
  | { type: "GET_HOST_QUEUE_STATS" }
  | { type: "GET_PIPELINE_STATS" }
  | { type: "GET_SETTINGS" }
  | { type: "UPDATE_SETTINGS"; payload: Partial<RecorderSettings> }
  | { type: "START_RECORDING" }
  | { type: "STOP_RECORDING" }
  | { type: "EXPORT_SESSION" }
  | { type: "CLEAR_SESSION_DATA" };
