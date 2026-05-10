// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { compressTextTree, htmlToTextTree } from "../../../src/lib/html-text-tree";
import {
  ROOT_VERTEX_ID,
  graphToDFSIndentedText,
  mergeTextTreeIntoGraph,
  normalizeMergedTextGraph,
  removeVerticesIntroducedByLedgerSeq,
} from "../../../src/lib/merged-text-graph";
import type { TextTreeNode } from "../../../src/lib/html-text-tree";

function node(
  tag: string,
  text: string,
  children: TextTreeNode[] = [],
  role?: string,
): TextTreeNode {
  return { tag, text, role, children };
}

describe("merged-text-graph", () => {
  it("merges an html-derived tree into an empty graph", async () => {
    const tree = compressTextTree(
      htmlToTextTree("<main><section>Feed</section><article><h1>Post</h1></article></main>"),
    );
    const merged = await mergeTextTreeIntoGraph(null, tree, 1);

    expect(merged.stats.verticesAdded).toBeGreaterThan(0);
    expect(merged.graph.childrenByParent[ROOT_VERTEX_ID].length).toBeGreaterThan(0);
    for (const id of merged.graph.childrenByParent[ROOT_VERTEX_ID]) {
      expect(merged.graph.vertices[id]).toBeDefined();
      expect(merged.graph.vertices[id].depth).toBe(0);
    }
  });

  it("adds a subtree under an existing parent without duplicating that parent", async () => {
    const first = compressTextTree(htmlToTextTree("<div><div>Thread<div>hello</div></div></div>"));
    const second = compressTextTree(
      htmlToTextTree("<div><div>Thread<div>hello</div><div>new message</div></div></div>"),
    );

    const afterFirst = await mergeTextTreeIntoGraph(null, first, 1);
    const rootId = afterFirst.graph.childrenByParent[ROOT_VERTEX_ID][0];
    const firstLevelChildren = afterFirst.graph.childrenByParent[rootId] ?? [];

    const afterSecond = await mergeTextTreeIntoGraph(afterFirst.graph, second, 2);
    const nextChildren = afterSecond.graph.childrenByParent[rootId] ?? [];

    expect(afterSecond.stats.verticesAdded).toBeGreaterThan(0);
    expect(nextChildren.length).toBeGreaterThan(firstLevelChildren.length);
    expect(afterSecond.graph.vertices[rootId].introducedLedgerSeq).toBe(1);
  });

  it("renders DFS output with tabs by vertex depth", () => {
    const graph = normalizeMergedTextGraph({
      vertices: {
        a: { depth: 0, text: "A", introducedLedgerSeq: 1 },
        b: { depth: 1, text: "B line 1\nB line 2", introducedLedgerSeq: 1 },
        c: { depth: 2, text: "C", introducedLedgerSeq: 1 },
      },
      childrenByParent: {
        [ROOT_VERTEX_ID]: ["a"],
        a: ["b"],
        b: ["c"],
      },
    });

    expect(graphToDFSIndentedText(graph)).toBe("A\n\tB line 1\n\tB line 2\n\t\tC");
  });

  it("removes all vertices introduced by a ledger sequence", async () => {
    const tree1 = compressTextTree(htmlToTextTree("<div><p>one</p></div>"));
    const tree2 = compressTextTree(htmlToTextTree("<div><p>one</p><p>two</p></div>"));
    const merged1 = await mergeTextTreeIntoGraph(null, tree1, 1);
    const merged2 = await mergeTextTreeIntoGraph(merged1.graph, tree2, 2);

    const removed = removeVerticesIntroducedByLedgerSeq(merged2.graph, 2);
    const text = graphToDFSIndentedText(removed.graph);

    expect(removed.removedVertexCount).toBeGreaterThan(0);
    expect(text).toContain("one");
    expect(text).not.toContain("two");
  });

  it("stabilizes ids when sibling order changes", async () => {
    const first = node("div", "", [
      node("article", "Thread"),
      node("article", "Reply"),
      node("article", "Footer"),
    ]);
    const second = node("div", "", [
      node("article", "Footer"),
      node("article", "Thread"),
      node("article", "Reply"),
    ]);

    const merged1 = await mergeTextTreeIntoGraph(null, first, 1);
    const merged2 = await mergeTextTreeIntoGraph(merged1.graph, second, 2);

    expect(merged2.stats.verticesAdded).toBe(0);
    expect(merged2.stats.edgesAdded).toBe(0);
    expect(Object.keys(merged2.graph.vertices).length).toBe(
      Object.keys(merged1.graph.vertices).length,
    );
  });

  it("keeps duplicate insertion idempotent on a large deep tree", async () => {
    const deepLeaf = node("span", "Depth 6", [node("span", "Depth 7")]);
    const largeTree = node("main", "", [
      node("section", "Section A", [
        node("div", "A-1"),
        node("div", "A-2", [node("div", "A-2-i"), node("div", "A-2-ii", [deepLeaf])]),
      ]),
      node("section", "Section B", [
        node("div", "B-1"),
        node("div", "B-2"),
        node("div", "B-3", [node("button", "Open", [], "button")]),
      ]),
    ]);

    const first = await mergeTextTreeIntoGraph(null, largeTree, 1);
    const second = await mergeTextTreeIntoGraph(first.graph, largeTree, 2);

    expect(second.stats.verticesAdded).toBe(0);
    expect(second.stats.edgesAdded).toBe(0);
    expect(Object.keys(second.graph.vertices).length).toBe(
      Object.keys(first.graph.vertices).length,
    );
    for (const vertex of Object.values(second.graph.vertices)) {
      expect(vertex.introducedLedgerSeq).toBe(1);
    }
  });

  it("adds only leaf descendants when second pass extends deep branch", async () => {
    const base = node("main", "", [
      node("section", "feed", [
        node("article", "holdout", [node("p", "line 1"), node("p", "line 2")]),
      ]),
    ]);
    const extended = node("main", "", [
      node("section", "feed", [
        node("article", "holdout", [
          node("p", "line 1"),
          node("p", "line 2"),
          node("div", "new depth 1", [node("div", "new depth 2", [node("span", "new depth 3")])]),
        ]),
      ]),
    ]);

    const first = await mergeTextTreeIntoGraph(null, base, 1);
    const holdoutId = Object.entries(first.graph.vertices).find(
      ([, vertex]) => vertex.text === "holdout",
    )?.[0];
    expect(holdoutId).toBeDefined();
    const firstVertexCount = Object.keys(first.graph.vertices).length;

    const second = await mergeTextTreeIntoGraph(first.graph, extended, 2);
    const secondHoldoutId = Object.entries(second.graph.vertices).find(
      ([, vertex]) => vertex.text === "holdout",
    )?.[0];
    expect(secondHoldoutId).toBe(holdoutId);
    expect(second.stats.verticesAdded).toBe(3);
    expect(second.stats.edgesAdded).toBe(3);
    expect(Object.keys(second.graph.vertices).length).toBe(firstVertexCount + 3);
  });

  it("splits ids when same text appears at different depths", async () => {
    const shallow = node("main", "", [node("article", "Same payload")]);
    const deep = node("main", "", [
      node("section", "", [node("div", "", [node("article", "Same payload")])]),
    ]);

    const afterShallow = await mergeTextTreeIntoGraph(null, shallow, 1);
    const afterBoth = await mergeTextTreeIntoGraph(afterShallow.graph, deep, 2);

    const samePayloadIds = Object.entries(afterBoth.graph.vertices)
      .filter(([, vertex]) => vertex.text === "Same payload")
      .map(([id]) => id);
    expect(samePayloadIds.length).toBe(2);
  });

  it("keeps large wide trees free of duplicate child links", async () => {
    const wide = node("main", "", [
      node(
        "ul",
        "",
        Array.from({ length: 20 }, (_, i) => node("li", `row-${i}`)),
      ),
      node("section", "", [
        node("div", "alpha"),
        node("div", "beta"),
        node("div", "gamma", [node("span", "g-1"), node("span", "g-2")]),
      ]),
    ]);
    const widePermuted = node("main", "", [
      node(
        "ul",
        "",
        Array.from({ length: 20 }, (_, i) => node("li", `row-${19 - i}`)),
      ),
      node("section", "", [
        node("div", "gamma", [node("span", "g-1"), node("span", "g-2")]),
        node("div", "alpha"),
        node("div", "beta"),
      ]),
    ]);

    const first = await mergeTextTreeIntoGraph(null, wide, 1);
    const second = await mergeTextTreeIntoGraph(first.graph, widePermuted, 2);

    expect(second.stats.verticesAdded).toBe(0);
    expect(second.stats.edgesAdded).toBe(0);
    for (const children of Object.values(second.graph.childrenByParent)) {
      expect(new Set(children).size).toBe(children.length);
    }
  });
});
