import { cleanSectionLine } from "./format";
import type { ParsedSection, SectionParseInput } from "./types";

const BLOCK_TAG_RE =
  /<(\/)?(div|section|article|main|nav|aside|header|footer|ul|ol|li|p|h[1-6]|br)\b[^>]*>/gi;
const STRIP_TAG_RE = /<[^>]+>/g;
const SCRIPT_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

function textFromHtml(html: string): string {
  return html
    .replace(SCRIPT_STYLE_RE, " ")
    .replace(BLOCK_TAG_RE, (_match, isClosing: string | undefined) => (isClosing ? "\n" : "\n"))
    .replace(STRIP_TAG_RE, " ");
}

function normalizeLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map(cleanSectionLine)
    .filter((line) => line.length > 0);
}

function isHeadingLike(line: string): boolean {
  if (line.length === 0 || line.length > 56) {
    return false;
  }
  if (/^[\d\s]+$/.test(line)) {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9 .:_-]*$/.test(line);
}

function toSectionsFromLines(lines: string[]): ParsedSection[] {
  if (lines.length === 0) {
    return [];
  }
  const sections: ParsedSection[] = [];
  let current: ParsedSection = {
    title: "content",
    lines: [],
  };

  for (const line of lines) {
    if (isHeadingLike(line) && current.lines.length > 0) {
      sections.push(current);
      current = {
        title: line,
        lines: [line],
      };
      continue;
    }
    current.lines.push(line);
  }
  // c8 ignore next -- with non-empty input this final flush always runs.
  if (current.lines.length > 0) {
    sections.push(current);
  }
  return sections.slice(0, 25);
}

export function parseGenericSections(input: SectionParseInput): ParsedSection[] {
  const sourceText =
    input.htmlContent && input.htmlContent.trim().length > 0
      ? textFromHtml(input.htmlContent)
      : input.textContent;
  const lines = normalizeLines(sourceText);
  return toSectionsFromLines(lines);
}
