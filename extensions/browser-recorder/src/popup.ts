import type { RecorderState, SessionStats } from "./lib/schema";

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
let latestState: RecorderState | null = null;
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
    !openSettingsBtn
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
  const isStopping = state.isStopping ?? false;
  const statusText = state.isRecording
    ? `Recording: ${state.sessionId ?? "unknown"}`
    : isStopping
      ? "Stopping workers..."
      : `Stopped${state.sessionId ? ` (last: ${state.sessionId})` : ""}`;
  statusEl!.textContent = statusText;
  startBtn!.disabled = isBusy || state.isRecording || isStopping;
  stopBtn!.disabled = isBusy || !state.isRecording;
  exportBtn!.disabled = isBusy || state.isRecording || isStopping || !state.sessionId;
  clearBtn!.disabled = isBusy || isStopping;
  openSettingsBtn!.disabled = isBusy;
}

function renderStats(stats: SessionStats): void {
  const storageMb = (stats.storageBytesInUse / (1024 * 1024)).toFixed(2);
  statsEl!.textContent = `Pages: ${stats.pageCount} | URLs: ${stats.urlCount} | Storage: ${storageMb} MB`;
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
      setMessage("Recording started.");
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
      setMessage("Recording stopped and queue drained.");
    });
  });

  exportBtn!.addEventListener("click", () => {
    void withButtonAction(async () => {
      const response = await sendMessage<{
        sessionId: string;
        pageCount: number;
        urlCount: number;
      }>("EXPORT_SESSION");
      if (!response.ok) {
        throw new Error(response.error ?? "Export failed.");
      }
      setMessage(
        `Exported ${response.pageCount ?? 0} pages from ${response.urlCount ?? 0} URLs into one zip file.`,
      );
      await refreshStats();
    });
  });

  clearBtn!.addEventListener("click", () => {
    void withButtonAction(async () => {
      const response = await sendMessage("CLEAR_SESSION_DATA");
      if (!response.ok) {
        throw new Error(response.error ?? "Failed to clear session data.");
      }
      await refreshState();
      await refreshStats();
      setMessage("Capture database cleared.");
    });
  });

  openSettingsBtn!.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
}

assertElements();
wireEvents();
void refreshState();
void refreshStats();
const statsPollTimer = window.setInterval(() => {
  void refreshStats();
  void refreshState();
}, 1000);
window.addEventListener("unload", () => {
  window.clearInterval(statsPollTimer);
});
