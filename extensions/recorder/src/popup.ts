import type { RecorderSettings, RecorderState, SessionStats } from "./lib/schema";

type BackgroundResponse<T = unknown> = {
  ok: boolean;
  error?: string;
  state?: RecorderState;
} & T;

const statusEl = document.querySelector<HTMLDivElement>("#status");
const statsEl = document.querySelector<HTMLDivElement>("#stats");
const messageEl = document.querySelector<HTMLDivElement>("#message");
const startBtn = document.querySelector<HTMLButtonElement>("#start-btn");
const stopBtn = document.querySelector<HTMLButtonElement>("#stop-btn");
const exportBtn = document.querySelector<HTMLButtonElement>("#export-btn");
const clearBtn = document.querySelector<HTMLButtonElement>("#clear-btn");
const openSettingsBtn = document.querySelector<HTMLButtonElement>("#open-settings-btn");
const clearDialog = document.querySelector<HTMLDialogElement>("#clear-dialog");
const dlgTrim = document.querySelector<HTMLButtonElement>("#dlg-trim");
const dlgFull = document.querySelector<HTMLButtonElement>("#dlg-full");
const dlgCancel = document.querySelector<HTMLButtonElement>("#dlg-cancel");

let latestState: RecorderState | null = null;
let latestSettings: RecorderSettings | null = null;
let isBusy = false;

function assertElements(): void {
  if (
    !statusEl ||
    !statsEl ||
    !messageEl ||
    !startBtn ||
    !stopBtn ||
    !exportBtn ||
    !clearBtn ||
    !openSettingsBtn ||
    !clearDialog ||
    !dlgTrim ||
    !dlgFull ||
    !dlgCancel
  ) {
    throw new Error("Popup DOM elements are missing.");
  }
}

function setMessage(message: string, isError = false): void {
  messageEl!.textContent = message;
  messageEl!.style.color = isError ? "#d33" : "";
}

function renderState(state: RecorderState): void {
  latestState = state;
  const rawMb = (state.storageBytesRaw / (1024 * 1024)).toFixed(2);
  const procMb = (state.storageBytesProcessed / (1024 * 1024)).toFixed(2);
  const totalMb = (state.storageBytesTotal / (1024 * 1024)).toFixed(2);
  const statusText = state.isRecording
    ? `Recording${state.sessionId ? ` (${state.sessionId.slice(0, 8)}…)` : ""}`
    : `Stopped${state.forceStoppedForLimit ? " — storage limit reached" : ""}`;
  statusEl!.textContent = `${statusText}\nRaw ${rawMb} MB\nOutput ${procMb} MB\nTotal ${totalMb} MB`;
  const settingsLimitBytes = (latestSettings?.limitForceStopMb ?? 32) * 1024 * 1024;
  const blockedByLimit =
    state.recordingBlockedForLimit ||
    (!state.isRecording && state.storageBytesProcessed >= settingsLimitBytes);
  startBtn!.disabled = isBusy || state.isRecording || blockedByLimit;
  stopBtn!.disabled = isBusy || !state.isRecording;
  exportBtn!.disabled = isBusy || state.isRecording;
  clearBtn!.disabled = isBusy || state.isRecording;
  openSettingsBtn!.disabled = isBusy;
}

function renderStats(stats: SessionStats): void {
  statsEl!.textContent = `Ingests: ${stats.snapshotCount} | URLs: ${stats.urlCount} · Output ${(
    stats.storageBytesProcessed /
    (1024 * 1024)
  ).toFixed(2)} MB`;
}

function setBusy(nextBusy: boolean): void {
  isBusy = nextBusy;
  if (latestState) {
    renderState(latestState);
    return;
  }
  startBtn!.disabled = nextBusy;
  stopBtn!.disabled = nextBusy;
  exportBtn!.disabled = true;
  clearBtn!.disabled = nextBusy;
}

async function refreshSettings(): Promise<void> {
  const response = await sendMessage<{ settings: RecorderSettings }>("GET_SETTINGS");
  if (!response.ok || !response.settings) {
    return;
  }
  latestSettings = response.settings;
}

async function sendMessage<T = unknown>(type: string): Promise<BackgroundResponse<T>> {
  return chrome.runtime.sendMessage({ type }) as Promise<BackgroundResponse<T>>;
}

async function refreshState(): Promise<void> {
  const response = await sendMessage("GET_STATE");
  if (!response.ok || !response.state) {
    setMessage(response.error ?? "Unable to fetch recorder state.", true);
    return;
  }
  renderState(response.state);
}

async function refreshStats(): Promise<void> {
  const response = await sendMessage<{ stats: SessionStats }>("GET_SESSION_STATS");
  if (!response.ok || !response.stats) {
    return;
  }
  renderStats(response.stats);
}

async function withButtonAction(action: () => Promise<void>): Promise<void> {
  try {
    setBusy(true);
    setMessage("");
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setMessage(message, true);
  } finally {
    setBusy(false);
  }
}

function wireEvents(): void {
  startBtn!.addEventListener("click", () => {
    void withButtonAction(async () => {
      const response = await sendMessage("START_RECORDING");
      if (!response.ok || !response.state) {
        throw new Error(response.error ?? "Failed to start recording.");
      }
      renderState(response.state);
      await refreshStats();
      setMessage("Recording.");
    });
  });

  stopBtn!.addEventListener("click", () => {
    void withButtonAction(async () => {
      const response = await sendMessage("STOP_RECORDING");
      if (!response.ok || !response.state) {
        throw new Error(response.error ?? "Failed to stop recording.");
      }
      renderState(response.state);
      await refreshStats();
      setMessage("Stopped; raw capture cleared.");
    });
  });

  exportBtn!.addEventListener("click", () => {
    void withButtonAction(async () => {
      const response = await sendMessage<{
        sessionId: string | null;
        urlCount: number;
        snapshotCount: number;
      }>("EXPORT_SESSION");
      if (!response.ok) {
        throw new Error(response.error ?? "Export failed.");
      }
      setMessage(
        `Exported ${response.snapshotCount ?? 0} ingests across ${response.urlCount ?? 0} URLs.`,
      );
      await refreshStats();
    });
  });

  clearBtn!.addEventListener("click", () => {
    clearDialog!.showModal();
  });

  dlgCancel!.addEventListener("click", () => {
    clearDialog!.close();
  });

  dlgTrim!.addEventListener("click", () => {
    clearDialog!.close();
    void withButtonAction(async () => {
      const response = await chrome.runtime.sendMessage({ type: "CLEAR_TRIM" });
      if (!response.ok) {
        throw new Error(response.error ?? "Clear failed.");
      }
      await refreshState();
      await refreshStats();
      setMessage("Cleared oldest output (~half size).");
    });
  });

  dlgFull!.addEventListener("click", () => {
    clearDialog!.close();
    void withButtonAction(async () => {
      const response = await chrome.runtime.sendMessage({ type: "CLEAR_FULL" });
      if (!response.ok) {
        throw new Error(response.error ?? "Clear failed.");
      }
      await refreshState();
      await refreshStats();
      setMessage("All stored output cleared.");
    });
  });

  openSettingsBtn!.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
}

assertElements();
wireEvents();
void refreshSettings();
void refreshState();
void refreshStats();
const statsPollTimer = window.setInterval(() => {
  void refreshSettings();
  void refreshStats();
  void refreshState();
}, 1000);
window.addEventListener("unload", () => {
  window.clearInterval(statsPollTimer);
});
