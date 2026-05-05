// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { transformHtmlToIndentedText } from "../../../src/lib/html-textify";

describe("html textification", () => {
  it("builds compressed tree depth with indented children", () => {
    const html = "<div>a<div>b<div>e</div><div>f</div></div><div>c<div>d</div></div></div>";
    const result = transformHtmlToIndentedText(html);
    expect(result).toBe(["a", "-- b", "---- e", "---- f", "", "-- c", "---- d"].join("\n"));
  });

  it("collapses transparent wrapper chains", () => {
    const html = "<div><div><div><div>leaf</div></div></div></div>";
    const result = transformHtmlToIndentedText(html);
    expect(result).toBe("leaf");
  });

  it("linkedin-like post + comment keeps thread hierarchy", () => {
    const html = `
      <div>
        <div>
          <div>Allan Batista</div>
          <div>Founder @ Solução42</div>
          <div>Encerro hoje um capítulo...</div>
        </div>
        <div>
          <div>Frederico Elias</div>
          <div>Head de Performance @VTEX Ads</div>
          <div>Grande, mestre!!</div>
        </div>
      </div>
    `;
    const result = transformHtmlToIndentedText(html);
    expect(result).toContain("Allan Batista");
    expect(result).toContain("-- Founder @ Solução42");
    expect(result).toContain("-- Encerro hoje um capítulo...");
    expect(result).toContain("Frederico Elias");
    expect(result).toContain("-- Head de Performance @VTEX Ads");
    expect(result).toContain("-- Grande, mestre!!");
  });

  it("github-like profile groups nearby lines", () => {
    const html = `
      <div>
        <div>Gustavo Gardusi</div>
        <div>gardusig</div>
        <div>Edit profile</div>
        <div>404 followers</div>
        <div>656 following</div>
        <div>Brazil</div>
        <div>gustavo.gardusi@gmail.com</div>
      </div>
    `;
    const result = transformHtmlToIndentedText(html);
    expect(result).toContain("Gustavo Gardusi");
    expect(result).toContain("-- gardusig");
    expect(result).toContain("-- Edit profile");
    expect(result).toContain("-- 404 followers");
    expect(result).toContain("-- 656 following");
    expect(result).toContain("-- Brazil");
    expect(result).toContain("-- gustavo.gardusi@gmail.com");
  });
});
