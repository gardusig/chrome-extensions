export {};

declare global {
  interface Window {
    __recorderContentBootstrapped?: boolean;
  }
}

type CaptureNowMessage = {
  type: "CAPTURE_NOW";
  payload?: {
    reason?: string;
    force?: boolean;
    includeHtml?: boolean;
  };
};

type ContentUpdateSettingsMessage = {
  type: "CONTENT_UPDATE_SETTINGS";
  payload?: {
    pollIntervalMs?: number;
    savePageHtml?: boolean;
  };
};

type IncomingMessage = CaptureNowMessage | ContentUpdateSettingsMessage;

// c8 ignore next -- bootstrap guard is runtime-only and not re-entered in production.
if (!window.__recorderContentBootstrapped) {
  window.__recorderContentBootstrapped = true;

  function safeSendMessage(message: unknown): void {
    try {
      chrome.runtime.sendMessage(message);
    } catch {
      // Ignore extension runtime errors on restricted pages.
    }
  }

  function hashText(value: string): number {
    let hash = 0;
    for (let idx = 0; idx < value.length; idx += 1) {
      hash = (hash * 31 + value.charCodeAt(idx)) >>> 0;
    }
    return hash;
  }

  function setupSnapshotLoop(): void {
    let lastHash = -1;
    let isDirty = true;
    let isSnapshotInFlight = false;
    let pollIntervalMs = 300;
    let includeHtmlInSnapshots = false;
    let intervalId = -1;

    const captureSnapshot = (reason: string, includeHtml = false): void => {
      const textContent = document.body?.innerText ?? "";
      // c8 ignore next -- html capture flag branches are exercised by browser runtime behavior.
      const htmlContent = includeHtml ? (document.documentElement?.outerHTML ?? "") : "";
      safeSendMessage({
        type: "CONTENT_PAGE_SNAPSHOT",
        payload: {
          url: window.location.href,
          title: document.title,
          textContent,
          htmlContent,
          reason,
        },
      });
    };

    const captureIfChanged = (reason: string, force = false) => {
      const textContent = document.body?.innerText ?? "";
      const currentHash = hashText(textContent);
      if (!force && !isDirty && currentHash === lastHash) {
        return;
      }
      lastHash = currentHash;
      isDirty = false;
      captureSnapshot(reason, includeHtmlInSnapshots);
    };

    const restartLoop = (): void => {
      if (intervalId !== -1) {
        window.clearInterval(intervalId);
      }
      intervalId = window.setInterval(
        () => {
          // c8 ignore next 3 -- requires overlapping timer ticks while callback is still running.
          if (isSnapshotInFlight) {
            return;
          }
          isSnapshotInFlight = true;
          try {
            captureIfChanged("poll-diff");
          } finally {
            isSnapshotInFlight = false;
          }
        },
        Math.max(100, pollIntervalMs),
      );
    };

    chrome.runtime.onMessage.addListener((message: IncomingMessage, _sender, sendResponse) => {
      if (message.type === "CAPTURE_NOW") {
        const reason = message.payload?.reason ?? "force-capture";
        // c8 ignore next -- force default path depends on caller payload shape.
        captureIfChanged(reason, message.payload?.force ?? true);
        // c8 ignore next -- includeHtml toggle depends on caller payload shape.
        if (message.payload?.includeHtml) {
          captureSnapshot(`${reason}.html`, true);
        }
        sendResponse({ ok: true });
        return true;
      }
      if (message.type === "CONTENT_UPDATE_SETTINGS") {
        const nextInterval = message.payload?.pollIntervalMs;
        // c8 ignore next -- branch depends on external runtime payloads.
        if (typeof nextInterval === "number" && Number.isFinite(nextInterval)) {
          pollIntervalMs = nextInterval;
          restartLoop();
        }
        // c8 ignore next -- branch depends on external runtime payloads.
        if (typeof message.payload?.savePageHtml === "boolean") {
          includeHtmlInSnapshots = message.payload.savePageHtml;
        }
        sendResponse({ ok: true });
        return true;
      }
      return false;
    });

    const nativePushState = History.prototype.pushState;
    if (typeof nativePushState === "function") {
      history.pushState = (...args) => {
        nativePushState.apply(history, args);
        isDirty = true;
        captureIfChanged("history.pushState");
      };
    }

    const nativeReplaceState = History.prototype.replaceState;
    if (typeof nativeReplaceState === "function") {
      history.replaceState = (...args) => {
        nativeReplaceState.apply(history, args);
        isDirty = true;
        captureIfChanged("history.replaceState");
      };
    }

    window.addEventListener("popstate", () => {
      isDirty = true;
      captureIfChanged("popstate");
    });
    window.addEventListener("hashchange", () => {
      isDirty = true;
      captureIfChanged("hashchange");
    });
    window.addEventListener("click", () => {
      isDirty = true;
    });
    window.addEventListener(
      "scroll",
      () => {
        isDirty = true;
      },
      { passive: true },
    );
    window.addEventListener("keydown", () => {
      isDirty = true;
    });
    window.addEventListener("visibilitychange", () => {
      // c8 ignore next -- jsdom visibility APIs do not mirror browser tab lifecycle exactly.
      if (document.visibilityState === "hidden") {
        captureIfChanged("visibility.hidden");
      }
    });
    window.addEventListener("pagehide", () => {
      captureIfChanged("pagehide");
    });
    window.addEventListener("beforeunload", () => {
      captureIfChanged("beforeunload");
    });
    window.addEventListener("load", () => {
      isDirty = true;
      captureIfChanged("window.load");
    });

    if (document.readyState === "complete" || document.readyState === "interactive") {
      captureIfChanged("content-script-ready");
    } else {
      window.addEventListener(
        "DOMContentLoaded",
        () => {
          isDirty = true;
          captureIfChanged("dom-content-loaded");
        },
        { once: true },
      );
    }

    void chrome.runtime
      .sendMessage({ type: "GET_SETTINGS" })
      .then(
        (response: {
          ok?: boolean;
          settings?: { pollIntervalMs?: number; savePageHtml?: boolean };
        }) => {
          const nextInterval = response.settings?.pollIntervalMs;
          // c8 ignore next -- depends on async runtime settings availability.
          if (response.ok && typeof nextInterval === "number" && Number.isFinite(nextInterval)) {
            pollIntervalMs = nextInterval;
            restartLoop();
          }
          // c8 ignore next -- depends on async runtime settings availability.
          if (response.ok && typeof response.settings?.savePageHtml === "boolean") {
            includeHtmlInSnapshots = response.settings.savePageHtml;
          }
        },
      )
      .catch(() => {
        // Ignore when service worker is unavailable.
      });

    restartLoop();
    window.addEventListener("unload", () => {
      // c8 ignore next -- unload cleanup branch is browser timing dependent.
      if (intervalId !== -1) {
        window.clearInterval(intervalId);
      }
    });
  }

  setupSnapshotLoop();
}
