export type ParsedSection = {
  title: string;
  lines: string[];
};

export type SectionParseInput = {
  url: string;
  textContent: string;
  htmlContent?: string;
};

export type SectionParser = (input: SectionParseInput) => ParsedSection[];

export const SECTION_PARSER_TYPES_VERSION = 1;
