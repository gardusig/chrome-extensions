import type { RecorderSettings } from "./lib/schema";

type BackgroundResponse<T = unknown> = {
  ok: boolean;
  error?: string;
} & T;

const pollIntervalEl = document.querySelector<HTMLInputElement>("#poll-interval");
const limitForceStopMbEl = document.querySelector<HTMLInputElement>("#limit-force-stop-mb");
const messageEl = document.querySelector<HTMLDivElement>("#message");

function assertElements(): void {
  if (!pollIntervalEl || !limitForceStopMbEl || !messageEl) {
    throw new Error("Missing options DOM elements.");
  }
}

function setMessage(text: string, isError = false): void {
  messageEl!.textContent = text;
  messageEl!.style.color = isError ? "#d33" : "";
}

async function sendMessage<T = unknown>(
  type: string,
  payload?: unknown,
): Promise<BackgroundResponse<T>> {
  return chrome.runtime.sendMessage(
    payload !== undefined ? { type, payload } : { type },
  ) as Promise<BackgroundResponse<T>>;
}

function renderSettings(settings: RecorderSettings): void {
  pollIntervalEl!.value = String(settings.pollIntervalMs);
  limitForceStopMbEl!.value = String(settings.limitForceStopMb);
}

async function save(): Promise<void> {
  const pollIntervalMs = Math.round(Number(pollIntervalEl!.value));
  const limitForceStopMb = Math.round(Number(limitForceStopMbEl!.value));
  const response = await sendMessage("UPDATE_SETTINGS", {
    pollIntervalMs,
    limitForceStopMb,
  });
  if (!response.ok) {
    throw new Error(response.error ?? "Save failed.");
  }
  setMessage("Saved.");
}

async function load(): Promise<void> {
  const response = await sendMessage<{ settings: RecorderSettings }>("GET_SETTINGS");
  if (!response.ok || !response.settings) {
    setMessage(response.error ?? "Unable to load settings.", true);
    return;
  }
  renderSettings(response.settings);
}

function wire(): void {
  for (const el of [pollIntervalEl, limitForceStopMbEl]) {
    el!.addEventListener("change", () => {
      void save().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setMessage(message, true);
      });
    });
  }
}

assertElements();
wire();
void load();
