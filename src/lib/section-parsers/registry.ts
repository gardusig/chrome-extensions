import { parseGenericSections } from "./generic";
import { parseSlackSections } from "./slack";
import type { ParsedSection, SectionParseInput, SectionParser } from "./types";

const HOST_PARSERS: Array<{ matches: (host: string) => boolean; parser: SectionParser }> = [
  {
    matches: (host) => host === "app.slack.com",
    parser: parseSlackSections,
  },
];

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function parseSections(input: SectionParseInput): ParsedSection[] {
  const host = hostFromUrl(input.url);
  for (const entry of HOST_PARSERS) {
    if (!entry.matches(host)) {
      continue;
    }
    const sections = entry.parser(input);
    // c8 ignore next -- explicit fast path when host-specific parser yields sections.
    if (sections.length > 0) {
      return sections;
    }
  }
  return parseGenericSections(input);
}
