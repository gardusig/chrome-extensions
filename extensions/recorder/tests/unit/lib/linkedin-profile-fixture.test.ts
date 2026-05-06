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

    const result = transformHtmlToIndentedText(html);
    expect(result).toContain("Gustavo Gardusi");
    expect(result).toContain("Software Engineer");
    expect(result).toContain("Amazon Web Services (AWS)");
    expect(result).toContain("UFU - Example University");
    expect(result).toContain("Open to work");
    expect(result).toContain("Backend roles");
  });
});
