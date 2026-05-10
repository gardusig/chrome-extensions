import type { ProcessedByUrlRecord, SiteMetadataRecord, SiteRequestLogRecord } from "./db";
import { graphToDFSIndentedText } from "./merged-text-graph";
import { createZip } from "./zip";

export function siteFolderFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.replace(/\./g, "-").toLowerCase() || "site";
  } catch {
    return "site";
  }
}

export function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/\./g, "-");
    const path =
      u.pathname === "/"
        ? "index"
        : u.pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/gi, "");
    const combined = `${host}-${path}`.toLowerCase().slice(0, 180);
    return combined || "page";
  } catch {
    return "page";
  }
}

export function exportZipBasename(now = new Date()): string {
  const d = now;
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}`;
  return `recorder-session-${stamp}.zip`;
}

export function buildZipEntriesFromProcessed(rows: ProcessedByUrlRecord[]): Array<{
  filename: string;
  content: string;
}> {
  const linesBySite = new Map<string, Set<string>>();
  for (const row of rows) {
    const site = siteFolderFromUrl(row.fullUrl);
    const output = graphToDFSIndentedText(row.graph);
    if (!linesBySite.has(site)) {
      linesBySite.set(site, new Set<string>());
    }
    const set = linesBySite.get(site)!;
    for (const line of output.split("\n")) {
      const normalized = line.trim();
      if (!normalized) {
        continue;
      }
      set.add(normalized);
    }
  }

  return [...linesBySite.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([site, lines]) => ({
      filename: `recorder/content/${site}.txt`,
      content: [...lines].sort().join("\n"),
    }));
}

function folderFromOrigin(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/\./g, "-").toLowerCase() || "site";
  } catch {
    return "site";
  }
}

export function buildZipEntriesFromSiteMetadata(rows: SiteMetadataRecord[]): Array<{
  filename: string;
  content: string;
}> {
  return rows
    .slice()
    .sort((a, b) => a.origin.localeCompare(b.origin))
    .map((row) => ({
      filename: `recorder/metadata/${folderFromOrigin(row.origin)}.txt`,
      content: row.lines.join("\n"),
    }));
}

export function buildZipEntriesFromSiteRequests(rows: SiteRequestLogRecord[]): Array<{
  filename: string;
  content: string;
}> {
  return rows
    .slice()
    .sort((a, b) => a.origin.localeCompare(b.origin))
    .map((row) => ({
      filename: `recorder/requests/${folderFromOrigin(row.origin)}.jsonl`,
      content: row.entries.map((entry) => JSON.stringify(entry)).join("\n"),
    }));
}

export function buildExportZipBytes(
  rows: ProcessedByUrlRecord[],
  siteMetadataRows: SiteMetadataRecord[],
  siteRequestRows: SiteRequestLogRecord[],
): Uint8Array {
  return createZip([
    ...buildZipEntriesFromProcessed(rows),
    ...buildZipEntriesFromSiteMetadata(siteMetadataRows),
    ...buildZipEntriesFromSiteRequests(siteRequestRows),
  ]);
}
