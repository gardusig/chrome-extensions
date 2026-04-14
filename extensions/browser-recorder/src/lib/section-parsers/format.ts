import type { ParsedSection } from "./types";

const MAX_LINE_LENGTH = 200;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeCommonHtmlEntities(value: string): string {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

export function cleanSectionLine(value: string): string {
  const decoded = decodeCommonHtmlEntities(value);
  const normalized = normalizeWhitespace(decoded);
  if (normalized.length <= MAX_LINE_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_LINE_LENGTH)}...`;
}

export function sanitizeSections(sections: ParsedSection[]): ParsedSection[] {
  const nextSections: ParsedSection[] = [];
  for (const section of sections) {
    const title = cleanSectionLine(section.title || "section");
    const lines = section.lines
      .map(cleanSectionLine)
      .filter((line) => line.length > 0)
      .slice(0, 250);
    if (lines.length === 0) {
      continue;
    }
    const nextSection: ParsedSection = {
      title,
      lines,
    };
    const previous = nextSections.at(-1);
    if (previous && previous.title === nextSection.title) {
      previous.lines.push(...nextSection.lines);
      previous.lines = previous.lines.slice(0, 250);
      continue;
    }
    nextSections.push(nextSection);
  }
  return nextSections;
}

export function formatSections(sections: ParsedSection[]): string {
  const clean = sanitizeSections(sections);
  if (clean.length === 0) {
    return "";
  }
  const chunks: string[] = [];
  for (const section of clean) {
    chunks.push(`=== section: ${section.title} ===`);
    for (const line of section.lines) {
      chunks.push(`\t${line}`);
    }
    chunks.push("");
  }
  return chunks.join("\n").trimEnd();
}
