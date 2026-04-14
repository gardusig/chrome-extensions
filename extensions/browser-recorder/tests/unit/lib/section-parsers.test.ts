import { describe, expect, it } from "vitest";
import {
  cleanSectionLine,
  formatSections,
  sanitizeSections,
} from "../../../src/lib/section-parsers/format";
import { parseGenericSections } from "../../../src/lib/section-parsers/generic";
import { parseSections } from "../../../src/lib/section-parsers/registry";
import { parseSlackSections } from "../../../src/lib/section-parsers/slack";
import { SECTION_PARSER_TYPES_VERSION } from "../../../src/lib/section-parsers/types";

describe("section parser format helpers", () => {
  it("exposes parser types module runtime marker", () => {
    expect(SECTION_PARSER_TYPES_VERSION).toBe(1);
  });

  it("cleans and truncates lines", () => {
    expect(cleanSectionLine("  hello   world  ")).toBe("hello world");
    expect(cleanSectionLine("&amp; &nbsp; &#39;")).toContain("&");
    const long = "x".repeat(240);
    expect(cleanSectionLine(long).endsWith("...")).toBe(true);
  });

  it("sanitizes and formats sections with separators and indentation", () => {
    const sanitized = sanitizeSections([
      { title: "  Main   ", lines: [" a ", "", "b"] },
      { title: "Empty", lines: ["   "] },
      { title: "", lines: ["alpha"] },
    ]);
    expect(sanitized).toEqual([
      { title: "Main", lines: ["a", "b"] },
      { title: "section", lines: ["alpha"] },
    ]);

    const formatted = formatSections(sanitized);
    expect(formatted).toContain("=== section: Main ===");
    expect(formatted).toContain("\ta");
    expect(formatted).toContain("\tb");
  });

  it("returns empty formatted output for empty section list", () => {
    expect(formatSections([])).toBe("");
  });
});

describe("generic parser", () => {
  it("parses html into heading-like sections", () => {
    const sections = parseGenericSections({
      url: "https://example.com",
      textContent: "",
      htmlContent:
        "<main><h1>Overview</h1><div>First item</div><section><h2>Details</h2><p>Second item</p></section></main>",
    });
    expect(sections.length).toBeGreaterThan(0);
    const allLines = sections.flatMap((section) => [section.title, ...section.lines]);
    expect(allLines.some((line) => line.includes("First item"))).toBe(true);
    expect(allLines.some((line) => line.includes("Second item"))).toBe(true);
  });

  it("falls back to text parsing when no html is available", () => {
    const sections = parseGenericSections({
      url: "https://example.com",
      textContent: "Main\n123\nItem A\nItem B\nDetails\nRow 1",
    });
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].lines.length).toBeGreaterThan(0);
  });
});

describe("slack parser", () => {
  it("splits known slack-like blocks", () => {
    const sections = parseSlackSections({
      url: "https://app.slack.com/client/T1",
      textContent:
        "Home\nDMs\nDirect messages\nFelipe Garcia\nPaul Robotson APP  Yesterday at 3:49 PM\nReply…",
    });
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.some((section) => section.title === "Messages")).toBe(true);
  });

  it("falls back to generic when slack content is empty", () => {
    const sections = parseSlackSections({
      url: "https://app.slack.com/client/T1",
      textContent: "",
      htmlContent: "<div><h1>Slack</h1><p>Fallback line</p></div>",
    });
    expect(sections.length).toBeGreaterThan(0);
  });
});

describe("parser registry", () => {
  it("uses slack parser for app.slack.com", () => {
    const sections = parseSections({
      url: "https://app.slack.com/client/T1",
      textContent: "Direct messages\nAlexandre Saran\nPaul Robotson APP  Yesterday at 3:49 PM",
    });
    expect(sections.length).toBeGreaterThan(0);
  });

  it("uses generic parser for unknown hosts and invalid urls", () => {
    const unknownHost = parseSections({
      url: "https://jira.example.com/browse/ENG-42",
      textContent: "Issue\nDescription",
    });
    expect(unknownHost.length).toBeGreaterThan(0);

    const invalidUrl = parseSections({
      url: "not-a-url",
      textContent: "Fallback\nLine",
    });
    expect(invalidUrl.length).toBeGreaterThan(0);
  });

  it("falls back to generic when slack-specific parser returns no sections", () => {
    const sections = parseSections({
      url: "https://app.slack.com/client/T1",
      textContent: "   ",
      htmlContent: "<div><h1>Fallback Slack</h1><p>row</p></div>",
    });
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].title.length).toBeGreaterThan(0);
  });
});
