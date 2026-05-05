import type { ProcessedByUrlRecord } from "./db";
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
  return rows.map((row) => {
    const folder = siteFolderFromUrl(row.fullUrl);
    const slug = slugFromUrl(row.fullUrl);
    const body = row.snapshots.map((s) => s.text.trimEnd()).join("\n----------\n");
    return { filename: `${folder}/${slug}.txt`, content: body };
  });
}

export function buildExportZipBytes(rows: ProcessedByUrlRecord[]): Uint8Array {
  return createZip(buildZipEntriesFromProcessed(rows));
}
