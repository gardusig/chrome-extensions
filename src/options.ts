import type { CapturePreset, PipelineStats, RecorderSettings } from "./lib/schema";

type BackgroundResponse<T = unknown> = {
  ok: boolean;
  error?: string;
} & T;

const savePageTextEl = document.querySelector<HTMLInputElement>("#save-page-text");
const semanticCaptureLevelEl = document.querySelector<HTMLSelectElement>("#semantic-capture-level");
const savePageHtmlEl = document.querySelector<HTMLInputElement>("#save-page-html");
const saveRequestDataEl = document.querySelector<HTMLInputElement>("#save-request-data");
const savePageMetaEl = document.querySelector<HTMLInputElement>("#save-page-meta");
const saveExportMetadataEl = document.querySelector<HTMLInputElement>("#save-export-metadata");
const forceInitialScanEl = document.querySelector<HTMLInputElement>("#force-initial-scan");
const pollIntervalEl = document.querySelector<HTMLInputElement>("#poll-interval");
const hardLimitMbEl = document.querySelector<HTMLSelectElement>("#hard-limit-mb");
const autoExportEl = document.querySelector<HTMLInputElement>("#auto-export");
const queuePendingEl = document.querySelector<HTMLElement>("#queue-pending");
const queueProcessingEl = document.querySelector<HTMLElement>("#queue-processing");
const queueFailedEl = document.querySelector<HTMLElement>("#queue-failed");
const queueProcessedEl = document.querySelector<HTMLElement>("#queue-processed");
const totalBytesEl = document.querySelector<HTMLElement>("#total-bytes");
const compressedBytesEl = document.querySelector<HTMLElement>("#compressed-bytes");
const queueUpdatedAtEl = document.querySelector<HTMLElement>("#queue-updated-at");
const urlTableBodyEl = document.querySelector<HTMLTableSectionElement>("#prefix-table-body");
const urlEmptyEl = document.querySelector<HTMLElement>("#prefix-empty");
const messageEl = document.querySelector<HTMLDivElement>("#message");
let diagnosticsPollTimer: number | null = null;

function assertElements(): void {
  if (
    !savePageTextEl ||
    !semanticCaptureLevelEl ||
    !savePageHtmlEl ||
    !saveRequestDataEl ||
    !savePageMetaEl ||
    !saveExportMetadataEl ||
    !forceInitialScanEl ||
    !pollIntervalEl ||
    !hardLimitMbEl ||
    !autoExportEl ||
    !queuePendingEl ||
    !queueProcessingEl ||
    !queueFailedEl ||
    !queueProcessedEl ||
    !totalBytesEl ||
    !compressedBytesEl ||
    !queueUpdatedAtEl ||
    !urlTableBodyEl ||
    !urlEmptyEl ||
    !messageEl
  ) {
    throw new Error("Missing options DOM elements.");
  }
}

function bytesToHuman(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(2)} MB`;
  }
  const kb = bytes / 1024;
  if (kb >= 1) {
    return `${kb.toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

function setMessage(message: string, isError = false): void {
  messageEl!.textContent = message;
  messageEl!.style.color = isError ? "#d33" : "";
}

function resolvePreset(settings: RecorderSettings): CapturePreset {
  if (
    settings.savePageText &&
    settings.savePageMeta &&
    !settings.savePageHtml &&
    !settings.saveRequestData
  ) {
    return "pages_only";
  }
  if (
    settings.savePageText &&
    settings.savePageMeta &&
    !settings.savePageHtml &&
    settings.saveRequestData
  ) {
    return "pages_requests";
  }
  return "full_capture";
}

async function sendMessageWithPayload<T = unknown>(
  type: string,
  payload: unknown,
): Promise<BackgroundResponse<T>> {
  return chrome.runtime.sendMessage({ type, payload }) as Promise<BackgroundResponse<T>>;
}

async function sendMessage<T = unknown>(type: string): Promise<BackgroundResponse<T>> {
  return chrome.runtime.sendMessage({ type }) as Promise<BackgroundResponse<T>>;
}

function renderSettings(settings: RecorderSettings): void {
  savePageTextEl!.checked = settings.savePageText;
  semanticCaptureLevelEl!.value = settings.semanticCaptureLevel;
  savePageHtmlEl!.checked = settings.savePageHtml;
  saveRequestDataEl!.checked = settings.saveRequestData;
  savePageMetaEl!.checked = settings.savePageMeta;
  saveExportMetadataEl!.checked = settings.saveExportMetadata;
  forceInitialScanEl!.checked = settings.forceInitialScanOnStart;
  pollIntervalEl!.value = String(settings.pollIntervalMs);
  hardLimitMbEl!.value = String(settings.hardLimitMb);
  autoExportEl!.checked = settings.autoExportOnSoftLimit;
}

function renderPipelineStats(stats: PipelineStats): void {
  queuePendingEl!.textContent = String(stats.queue.pending);
  queueProcessingEl!.textContent = String(stats.queue.processing);
  queueFailedEl!.textContent = String(stats.queue.failed);
  queueProcessedEl!.textContent = String(stats.queue.processed);
  totalBytesEl!.textContent = bytesToHuman(stats.totals.totalBytes);
  compressedBytesEl!.textContent = bytesToHuman(stats.totals.estimatedCompressedBytes);
  const updatedAt = new Date(stats.generatedAt);
  queueUpdatedAtEl!.textContent = Number.isNaN(updatedAt.getTime())
    ? "Updated: --"
    : `Updated: ${updatedAt.toLocaleTimeString()}`;

  urlTableBodyEl!.innerHTML = "";
  if (stats.urlRows.length === 0) {
    urlEmptyEl!.style.display = "";
    return;
  }
  urlEmptyEl!.style.display = "none";
  for (const row of stats.urlRows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding: 6px 4px; border-top: 1px solid rgba(125,125,125,0.25)">${row.url}</td>
      <td style="padding: 6px 4px; border-top: 1px solid rgba(125,125,125,0.25); text-align: right">${row.pageCount}</td>
      <td style="padding: 6px 4px; border-top: 1px solid rgba(125,125,125,0.25); text-align: right">${bytesToHuman(row.bytes)}</td>
    `;
    urlTableBodyEl!.appendChild(tr);
  }
}

async function refreshPipelineStats(): Promise<void> {
  const response = await sendMessage<{ stats?: PipelineStats }>("GET_PIPELINE_STATS");
  if (!response.ok || !response.stats) {
    return;
  }
  renderPipelineStats(response.stats);
}

async function persist(patch: Partial<RecorderSettings>, successMessage: string): Promise<void> {
  const response = await sendMessageWithPayload<{ settings: RecorderSettings }>(
    "UPDATE_SETTINGS",
    patch,
  );
  if (!response.ok || !response.settings) {
    setMessage(response.error ?? "Unable to save settings.", true);
    return;
  }
  renderSettings(response.settings);
  setMessage(successMessage);
}

function currentSettingsFromInputs(): RecorderSettings {
  const draft: RecorderSettings = {
    preset: "full_capture",
    hardLimitMb: Number(hardLimitMbEl!.value),
    autoExportOnSoftLimit: autoExportEl!.checked,
    pollIntervalMs: Number(pollIntervalEl!.value),
    forceInitialScanOnStart: forceInitialScanEl!.checked,
    savePageText: savePageTextEl!.checked,
    semanticCaptureLevel: semanticCaptureLevelEl!.value as RecorderSettings["semanticCaptureLevel"],
    savePageHtml: savePageHtmlEl!.checked,
    saveRequestData: saveRequestDataEl!.checked,
    savePageMeta: savePageMetaEl!.checked,
    saveExportMetadata: saveExportMetadataEl!.checked,
  };
  return {
    ...draft,
    preset: resolvePreset(draft),
  };
}

function bindEvents(): void {
  savePageTextEl!.addEventListener("change", () => {
    void persist({ savePageText: savePageTextEl!.checked }, "Saved page text setting.");
  });
  semanticCaptureLevelEl!.addEventListener("change", () => {
    const level = semanticCaptureLevelEl!.value as RecorderSettings["semanticCaptureLevel"];
    void persist({ semanticCaptureLevel: level }, "Saved semantic capture setting.");
  });
  savePageHtmlEl!.addEventListener("change", () => {
    void persist({ savePageHtml: savePageHtmlEl!.checked }, "Saved page HTML setting.");
  });
  saveRequestDataEl!.addEventListener("change", () => {
    void persist({ saveRequestData: saveRequestDataEl!.checked }, "Saved request capture setting.");
  });
  savePageMetaEl!.addEventListener("change", () => {
    void persist({ savePageMeta: savePageMetaEl!.checked }, "Saved metadata setting.");
  });
  saveExportMetadataEl!.addEventListener("change", () => {
    void persist(
      { saveExportMetadata: saveExportMetadataEl!.checked },
      "Saved export metadata setting.",
    );
  });
  forceInitialScanEl!.addEventListener("change", () => {
    void persist(
      { forceInitialScanOnStart: forceInitialScanEl!.checked },
      "Saved startup scan behavior.",
    );
  });
  pollIntervalEl!.addEventListener("change", () => {
    const value = Math.max(100, Math.min(5_000, Number(pollIntervalEl!.value || "100")));
    pollIntervalEl!.value = String(value);
    void persist({ pollIntervalMs: value }, "Saved poll interval.");
  });
  hardLimitMbEl!.addEventListener("change", () => {
    void persist({ hardLimitMb: Number(hardLimitMbEl!.value) }, "Saved storage limit.");
  });
  autoExportEl!.addEventListener("change", () => {
    void persist({ autoExportOnSoftLimit: autoExportEl!.checked }, "Saved auto-export setting.");
  });

  const quickPresetButtons = document.querySelectorAll<HTMLButtonElement>("[data-preset]");
  quickPresetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const preset = button.dataset.preset as CapturePreset;
      void persist({ preset }, `Applied preset: ${preset.replaceAll("_", " ")}.`);
    });
  });

  const derivePresetBtn = document.querySelector<HTMLButtonElement>("#derive-preset");
  derivePresetBtn?.addEventListener("click", () => {
    const derived = currentSettingsFromInputs();
    void persist({ preset: derived.preset }, `Derived and applied preset: ${derived.preset}.`);
  });
}

async function initialize(): Promise<void> {
  const response = await sendMessage<{ settings: RecorderSettings }>("GET_SETTINGS");
  if (!response.ok || !response.settings) {
    setMessage(response.error ?? "Unable to load settings.", true);
    return;
  }
  renderSettings(response.settings);
  await refreshPipelineStats();
  diagnosticsPollTimer = window.setInterval(() => {
    void refreshPipelineStats();
  }, 1000);
}

assertElements();
bindEvents();
void initialize();
window.addEventListener("unload", () => {
  if (diagnosticsPollTimer !== null) {
    window.clearInterval(diagnosticsPollTimer);
  }
});
