// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { transformHtmlToIndentedText } from "../../../src/lib/html-textify";

describe("slack-like thread fixture", () => {
  it("keeps sibling messages flat and thread replies nested", () => {
    const html = `
      <div>
        <div>
          <div>alice</div>
          <div>Hello team</div>
        </div>
        <div>
          <div>bob</div>
          <div>Can someone review?</div>
        </div>
        <div>
          <div>charlie</div>
          <div>Thread</div>
          <div>
            <div>Sure, on it.</div>
            <div>LGTM</div>
          </div>
        </div>
      </div>
    `;

    expect(transformHtmlToIndentedText(html)).toBe(
      [
        "alice",
        "-- Hello team",
        "",
        "bob",
        "-- Can someone review?",
        "",
        "charlie",
        "-- Thread",
        "-- Sure, on it.",
        "-- LGTM",
      ].join("\n"),
    );
  });
});
