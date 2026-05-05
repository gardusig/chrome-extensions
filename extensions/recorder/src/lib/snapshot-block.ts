import type { HeadMeta } from "./head-meta";
import { transformHtmlToIndentedText } from "./html-textify";
import { redactUrl } from "./redact";

export type RequestSummary = {
  url: string;
  method: string;
  requestPayloadBytes?: number | null;
  responseStatus?: number;
  responseBytes?: number | null;
  requestContentType?: string;
  responseContentType?: string;
};

export type SnapshotBlockInput = {
  fullUrl: string;
  capturedAt: string;
  tabId: number;
  windowId: number;
  title: string;
  headMeta: HeadMeta;
  rawHtml: string;
  relatedLinks?: string[];
  requests?: RequestSummary[];
};

function extractRelatedLinks(rawHtml: string, pageUrl: string, maxLinks = 50): string[] {
  try {
    const doc = new DOMParser().parseFromString(rawHtml, "text/html");
    const values: string[] = [];
    const seen = new Set<string>();
    for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
        continue;
      }
      let absolute: string;
      try {
        absolute = new URL(href, pageUrl).toString();
      } catch {
        continue;
      }
      const redacted = redactUrl(absolute);
      if (seen.has(redacted)) {
        continue;
      }
      seen.add(redacted);
      values.push(redacted);
      if (values.length >= maxLinks) {
        break;
      }
    }
    return values;
  } catch {
    return [];
  }
}

function formatMetaLines(
  meta: HeadMeta,
  input: Pick<SnapshotBlockInput, "rawHtml" | "fullUrl" | "relatedLinks" | "requests">,
): string[] {
  const lines: string[] = [];
  if (meta.title) {
    lines.push(`document_title: ${meta.title}`);
  }
  if (meta.htmlLang) {
    lines.push(`html_lang: ${meta.htmlLang}`);
  }
  if (meta.canonicalHref) {
    lines.push(`canonical: ${meta.canonicalHref}`);
  }
  if (meta.metaName) {
    for (const [k, v] of Object.entries(meta.metaName)) {
      lines.push(`meta[name=${k}]: ${v}`);
    }
  }
  if (meta.metaProperty) {
    for (const [k, v] of Object.entries(meta.metaProperty)) {
      lines.push(`meta[property=${k}]: ${v}`);
    }
  }
  if (meta.metaTwitter) {
    for (const [k, v] of Object.entries(meta.metaTwitter)) {
      lines.push(`meta[${k}]: ${v}`);
    }
  }
  const relatedLinks = input.relatedLinks ?? extractRelatedLinks(input.rawHtml, input.fullUrl);
  if (relatedLinks.length > 0) {
    lines.push("relatedLinks:");
    for (const link of relatedLinks) {
      lines.push(`  - ${link}`);
    }
  }
  if (input.requests && input.requests.length > 0) {
    lines.push("requests:");
    for (const request of input.requests) {
      lines.push(`  - method: ${request.method}`);
      lines.push(`    url: ${request.url}`);
      if (request.requestPayloadBytes !== undefined) {
        lines.push(`    requestPayloadBytes: ${request.requestPayloadBytes ?? "unknown"}`);
      }
      if (request.responseStatus !== undefined) {
        lines.push(`    responseStatus: ${request.responseStatus}`);
      }
      if (request.responseBytes !== undefined) {
        lines.push(`    responseBytes: ${request.responseBytes ?? "unknown"}`);
      }
      if (request.requestContentType) {
        lines.push(`    requestContentType: ${request.requestContentType}`);
      }
      if (request.responseContentType) {
        lines.push(`    responseContentType: ${request.responseContentType}`);
      }
    }
  }
  return lines;
}

/** One snapshot block: §H page_metadata + page_content (default tree outline §I.2). */
export function buildSnapshotBlockText(input: SnapshotBlockInput): string {
  const metaLines = [
    `url: ${input.fullUrl}`,
    `captured_at: ${input.capturedAt}`,
    `tab_id: ${input.tabId}`,
    `window_id: ${input.windowId}`,
    `title: ${input.title}`,
    ...formatMetaLines(input.headMeta, input),
  ];

  const pageContent = transformHtmlToIndentedText(input.rawHtml).trimEnd();

  return [
    "page_metadata:",
    ...metaLines.map((l) => `  ${l}`),
    "",
    "page_content:",
    ...pageContent.split("\n").map((l) => (l.length ? `  ${l}` : "")),
    "",
  ].join("\n");
}
