import { describe, expect, it } from "vitest";
import { transformHtmlToIndentedText } from "../../../src/lib/html-textify";

describe("html textification", () => {
  it("flattens nested div content", () => {
    const html = "<div>X<div>Y</div>Z</div>";
    const result = transformHtmlToIndentedText(html);
    expect(result).toBe(["X", "Y", "Z"].join("\n"));
  });

  it("keeps top-level block groups as plain lines", () => {
    const html = "<div>First</div><div>Second</div>";
    const result = transformHtmlToIndentedText(html);
    expect(result).toBe(["First", "Second"].join("\n"));
  });

  it("ignores scripts/styles and decodes entities", () => {
    const html =
      "<div>Tom &amp; Jerry<script>ignored()</script><style>body{display:none;}</style>&lt;ok&gt;</div>";
    const result = transformHtmlToIndentedText(html);
    expect(result).toBe(["Tom & Jerry", "<ok>"].join("\n"));
  });
});
