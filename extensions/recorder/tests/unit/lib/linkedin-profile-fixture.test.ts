// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { transformHtmlToIndentedText } from "../../../src/lib/html-textify";

describe("linkedin-like profile fixture", () => {
  it("formats profile cards close to UI grouping", () => {
    const html = `
      <div>
        <div>
          <div>Gustavo Gardusi</div>
          <div>Software Engineer</div>
          <div>Amazon Web Services (AWS)</div>
          <div>UFU - Example University</div>
        </div>
        <div>
          <div>Open to work</div>
          <div>Backend roles</div>
        </div>
      </div>
    `;

    expect(transformHtmlToIndentedText(html)).toBe(
      [
        "Gustavo Gardusi",
        "-- Software Engineer",
        "-- Amazon Web Services (AWS)",
        "-- UFU - Example University",
        "",
        "Open to work",
        "-- Backend roles",
      ].join("\n"),
    );
  });
});
