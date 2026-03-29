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

  const MAX_CHUNKS = 64;
  const MAX_SELECTOR_DEPTH = 3;
  const MAX_CHARS_PER_CHUNK = 8_000;
  const MAX_SEMANTIC_ELEMENTS = 150;
  const MAX_DOM_SCAN_ELEMENTS = 400;

  function normalizeChunkText(value: string): string {
    return value.replaceAll(/\s+/g, " ").trim();
  }

  function elementSelectorHint(element: Element | null): string {
    if (!element) {
      return "unknown";
    }
    const parts: string[] = [];
    let current: Element | null = element;
    for (let depth = 0; depth < MAX_SELECTOR_DEPTH && current; depth += 1) {
      const tag = current.tagName.toLowerCase();
      const idPart = current.id ? `#${current.id}` : "";
      const className = current.classList.item(0);
      const classPart = className ? `.${className}` : "";
      parts.unshift(`${tag}${idPart}${classPart}`);
      current = current.parentElement;
    }
    return parts.join(">");
  }

  function formatChunkLabel(
    source: "body" | "iframe" | "shadow" | "semantic",
    selector: string,
    extra?: Record<string, string | boolean>,
  ): string {
    const extraEntries = Object.entries(extra ?? {})
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");
    return extraEntries.length > 0
      ? `[source=${source} selector=${selector} ${extraEntries}]`
      : `[source=${source} selector=${selector}]`;
  }

  function createLabeledChunk(
    source: "body" | "iframe" | "shadow" | "semantic",
    text: string,
    selector: string,
    extra?: Record<string, string | boolean>,
  ): string | null {
    const normalized = normalizeChunkText(text);
    if (!normalized) {
      return null;
    }
    const limitedText =
      normalized.length > MAX_CHARS_PER_CHUNK
        ? `${normalized.slice(0, MAX_CHARS_PER_CHUNK)}…`
        : normalized;
    return `${formatChunkLabel(source, selector, extra)}\n${limitedText}`;
  }

  function collectOpenShadowRootChunks(): string[] {
    const chunks: string[] = [];
    const visitedShadowRoots = new Set<ShadowRoot>();
    const rootElement = document.documentElement;
    if (!rootElement) {
      return chunks;
    }
    const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_ELEMENT);
    let scannedElements = 0;
    while (scannedElements < MAX_DOM_SCAN_ELEMENTS) {
      const nextNode = walker.nextNode();
      if (!nextNode) {
        break;
      }
      scannedElements += 1;
      const element = nextNode as Element;
      const shadowRoot = element.shadowRoot;
      if (!shadowRoot || visitedShadowRoots.has(shadowRoot)) {
        continue;
      }
      visitedShadowRoots.add(shadowRoot);
      const chunk = createLabeledChunk(
        "shadow",
        shadowRoot.textContent ?? "",
        `${elementSelectorHint(element)}>shadow-root`,
      );
      if (chunk) {
        chunks.push(chunk);
      }
      if (chunks.length >= MAX_CHUNKS) {
        break;
      }
    }
    return chunks;
  }

  function collectSemanticChunks(): string[] {
    const chunks: string[] = [];
    const selector = "[aria-label], [alt], [title], input[placeholder], textarea[placeholder]";
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const seenValues = new Set<string>();
    for (const element of elements) {
      if (chunks.length >= MAX_SEMANTIC_ELEMENTS || chunks.length >= MAX_CHUNKS) {
        break;
      }
      const candidates: Array<{ kind: string; value: string | null }> = [
        { kind: "aria-label", value: element.getAttribute("aria-label") },
        { kind: "alt", value: element.getAttribute("alt") },
        { kind: "title", value: element.getAttribute("title") },
        { kind: "placeholder", value: element.getAttribute("placeholder") },
      ];
      for (const candidate of candidates) {
        if (!candidate.value) {
          continue;
        }
        const normalized = normalizeChunkText(candidate.value);
        if (!normalized || seenValues.has(`${candidate.kind}:${normalized}`)) {
          continue;
        }
        seenValues.add(`${candidate.kind}:${normalized}`);
        const chunk = createLabeledChunk("semantic", normalized, elementSelectorHint(element), {
          kind: candidate.kind,
        });
        if (chunk) {
          chunks.push(chunk);
        }
        if (chunks.length >= MAX_SEMANTIC_ELEMENTS || chunks.length >= MAX_CHUNKS) {
          break;
        }
      }
    }
    return chunks;
  }

  function collectSnapshotTextContent(): string {
    const chunks: string[] = [];
    const pushChunk = (chunk: string | null): void => {
      if (!chunk || chunks.length >= MAX_CHUNKS) {
        return;
      }
      chunks.push(chunk);
    };

    pushChunk(createLabeledChunk("body", document.body?.innerText ?? "", "body"));

    const iframeElements = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"));
    for (const iframe of iframeElements) {
      if (chunks.length >= MAX_CHUNKS) {
        break;
      }
      try {
        const frameBody = iframe.contentDocument?.body;
        if (!frameBody) {
          continue;
        }
        pushChunk(
          createLabeledChunk("iframe", frameBody.innerText ?? "", elementSelectorHint(iframe), {
            sameOrigin: true,
          }),
        );
      } catch {
        // Ignore cross-origin frame access failures.
      }
    }

    for (const shadowChunk of collectOpenShadowRootChunks()) {
      pushChunk(shadowChunk);
    }
    for (const semanticChunk of collectSemanticChunks()) {
      pushChunk(semanticChunk);
    }
    return chunks.join("\n\n");
  }

  function setupSnapshotLoop(): void {
    let lastHash = -1;
    let isSnapshotInFlight = false;
    let pollIntervalMs = 100;
    let includeHtmlInSnapshots = false;
    let intervalId = -1;

    const captureSnapshot = (reason: string, textContent: string, includeHtml = false): void => {
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
      const textContent = collectSnapshotTextContent();
      const currentHash = hashText(textContent);
      if (!force && currentHash === lastHash) {
        return;
      }
      lastHash = currentHash;
      captureSnapshot(reason, textContent, includeHtmlInSnapshots);
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
          captureSnapshot(`${reason}.html`, collectSnapshotTextContent(), true);
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

    window.addEventListener("pagehide", () => {
      captureIfChanged("pagehide", true);
    });
    window.addEventListener("beforeunload", () => {
      captureIfChanged("beforeunload", true);
    });

    if (document.readyState === "complete" || document.readyState === "interactive") {
      captureIfChanged("content-script-ready", true);
    } else {
      window.addEventListener(
        "DOMContentLoaded",
        () => {
          captureIfChanged("dom-content-loaded", true);
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
