import { extractHeadMetaForContent } from "./lib/content-head-meta";

export {};

declare global {
  interface Window {
    __recorderBoot?: boolean;
  }
}

type RecorderRecordingMessage = {
  type: "RECORDER_RECORDING";
  recording: boolean;
  pollIntervalMs: number;
  immediatePoll?: boolean;
};

if (!window.__recorderBoot) {
  window.__recorderBoot = true;

  let recording = false;
  let pollIntervalMs = 500;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function stopLoop(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function pushCapture(): void {
    if (!recording || !document.documentElement) {
      return;
    }
    const outerHTML = document.documentElement.outerHTML;
    void chrome.runtime
      .sendMessage({
        type: "RECORDER_CAPTURE",
        payload: {
          outerHTML,
          url: window.location.href,
          title: document.title,
          tabId: -1,
          windowId: -1,
          headMeta: extractHeadMetaForContent(outerHTML),
        },
      })
      .catch(() => {});
  }

  function restartLoop(): void {
    stopLoop();
    if (!recording) {
      return;
    }
    intervalId = setInterval(() => {
      pushCapture();
    }, pollIntervalMs);
  }

  chrome.runtime.onMessage.addListener(
    (message: RecorderRecordingMessage, _sender, sendResponse) => {
      if (message.type === "RECORDER_RECORDING") {
        recording = message.recording;
        pollIntervalMs = Math.max(100, message.pollIntervalMs ?? 500);
        restartLoop();
        if (recording && message.immediatePoll) {
          pushCapture();
        }
        sendResponse({ ok: true });
        return true;
      }
      return false;
    },
  );

  void chrome.runtime
    .sendMessage({ type: "GET_SETTINGS" })
    .then((res: { ok?: boolean; settings?: { pollIntervalMs?: number } }) => {
      if (res?.ok && res.settings?.pollIntervalMs) {
        pollIntervalMs = Math.max(100, res.settings.pollIntervalMs);
      }
    })
    .catch(() => {});

  void chrome.runtime
    .sendMessage({ type: "GET_STATE" })
    .then((res: { state?: { isRecording?: boolean } }) => {
      if (res?.state?.isRecording) {
        recording = true;
        restartLoop();
      }
    });
}
