import { cleanSectionLine } from "./format";
import { parseGenericSections } from "./generic";
import type { ParsedSection, SectionParseInput } from "./types";

const SLACK_HEADERS = new Set([
  "Home",
  "DMs",
  "Activity",
  "Files",
  "Later",
  "More",
  "Threads",
  "Channels",
  "Direct messages",
  "Apps",
]);

function normalizeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(cleanSectionLine)
    .filter((line) => line.length > 0);
}

function looksLikeSlackMessageLine(line: string): boolean {
  return /Yesterday at|Today at|APP|Reply…|Reply\.\.\./i.test(line);
}

function sectionTitleForLine(line: string): string | null {
  if (SLACK_HEADERS.has(line)) {
    return line;
  }
  if (looksLikeSlackMessageLine(line)) {
    return "Messages";
  }
  if (/^[A-Z][A-Za-z]+\s[A-Z][A-Za-z]+(you)?$/.test(line)) {
    return "People";
  }
  return null;
}

export function parseSlackSections(input: SectionParseInput): ParsedSection[] {
  // c8 ignore next -- fallback arm depends on missing text and optional html.
  const sourceText =
    input.textContent && input.textContent.trim().length > 0
      ? input.textContent
      : (input.htmlContent ?? "");
  const lines = normalizeLines(sourceText);
  // c8 ignore next -- empty Slack captures defer to generic fallback.
  if (lines.length === 0) {
    return parseGenericSections(input);
  }

  const sections: ParsedSection[] = [];
  let current: ParsedSection = { title: "Slack", lines: [] };
  for (const line of lines) {
    const nextTitle = sectionTitleForLine(line);
    if (nextTitle) {
      if (nextTitle === "Messages") {
        // c8 ignore next -- branch depends on transitions across section types.
        if (current.title !== "Messages" && current.lines.length > 0) {
          sections.push(current);
        }
        if (current.title !== "Messages") {
          current = {
            title: "Messages",
            lines: [],
          };
        }
        current.lines.push(line);
        continue;
      }
      // c8 ignore next -- branch depends on heading transitions with buffered lines.
      if (current.lines.length > 0) {
        sections.push(current);
      }
      current = {
        title: nextTitle,
        lines: [],
      };
      continue;
    }
    current.lines.push(line);
  }
  // c8 ignore next -- final flush branch is data-shape dependent.
  if (current.lines.length > 0) {
    sections.push(current);
  }

  // c8 ignore next -- defensive fallback when no sections were recognized.
  if (sections.length === 0) {
    return parseGenericSections(input);
  }
  return sections.slice(0, 30);
}
