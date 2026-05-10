// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  compressTextTree,
  htmlToTextTree,
  treeToIndentedText,
} from "../../../src/lib/html-text-tree";

describe("html text tree", () => {
  it("builds a nested tree and renders depth indentation", () => {
    const html = "<div>feed<div>post A<div>name X</div><div>content A</div></div></div>";
    const tree = compressTextTree(htmlToTextTree(html));
    const text = treeToIndentedText(tree);
    expect(text).toContain("feed");
    expect(text).toContain("-- post A");
    expect(text).toContain("---- name X");
    expect(text).toContain("---- content A");
  });

  it("keeps child text out of parent text", () => {
    const html = "<div><div><p>Istiyak Sheyam</p></div><div><p>Follow</p></div></div>";
    const tree = compressTextTree(htmlToTextTree(html));
    const text = treeToIndentedText(tree);
    const lines = text.split("\n").filter((line) => line.trim().length > 0);
    expect(lines.filter((line) => line.includes("Istiyak Sheyam"))).toHaveLength(1);
    expect(lines.filter((line) => line.includes("Follow"))).toHaveLength(1);
  });

  it("captures aria-label and alt text as meaningful vertices", () => {
    const html = `<div><button aria-label="Open control menu"></button><img alt="View profile"/></div>`;
    const tree = compressTextTree(htmlToTextTree(html));
    const text = treeToIndentedText(tree);
    expect(text).toContain("Open control menu");
    expect(text).toContain("View profile");
  });

  it("preserves parent-child structure across mixed html element types", () => {
    const html = `
      <main>
        <section><h2>Announcements</h2><button>Open</button></section>
        <article><a href="/x">Read more</a><span>Status: open</span></article>
        <ul><li>First</li><li>Second</li></ul>
      </main>
    `;
    const tree = compressTextTree(htmlToTextTree(html));
    const text = treeToIndentedText(tree);

    expect(text).toContain("Announcements");
    expect(text).toContain("Open");
    expect(text).toContain("Read more");
    expect(text).toContain("Status: open");
    expect(text).toContain("First");
    expect(text).toContain("Second");
  });
});
