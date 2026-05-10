import type { TextTreeNode } from "./html-text-tree";
import { sha256Hex } from "./sha256";

export const ROOT_VERTEX_ID = "__root__";

export type MergedGraphVertex = {
  depth: number;
  text: string;
  tag?: string;
  role?: string;
  introducedLedgerSeq: number;
};

export type MergedTextGraph = {
  vertices: Record<string, MergedGraphVertex>;
  childrenByParent: Record<string, string[]>;
};

export type MergeTextTreeStats = {
  verticesAdded: number;
  edgesAdded: number;
};

const FINGERPRINT_VERSION = 1;
const MAX_ANCESTOR_TAGS = 6;

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeVertexText(value: string): string {
  const lines = value
    .split("\n")
    .map((line) => normalizeInlineText(line))
    .filter((line) => line.length > 0);
  return lines.join("\n");
}

export function emptyMergedTextGraph(): MergedTextGraph {
  return { vertices: {}, childrenByParent: { [ROOT_VERTEX_ID]: [] } };
}

export function normalizeMergedTextGraph(graph?: MergedTextGraph | null): MergedTextGraph {
  const normalized: MergedTextGraph = {
    vertices: { ...(graph?.vertices ?? {}) },
    childrenByParent: { ...(graph?.childrenByParent ?? {}) },
  };
  if (!Array.isArray(normalized.childrenByParent[ROOT_VERTEX_ID])) {
    normalized.childrenByParent[ROOT_VERTEX_ID] = [];
  }
  return normalized;
}

type ParentFingerprintContext = {
  tag: string;
  role: string;
  textHash: string;
};

async function stableVertexFingerprint(input: {
  parentVertexId: string;
  depth: number;
  tag: string;
  role: string;
  text: string;
  parentTag: string;
  parentRole: string;
  parentTextHash: string;
  ancestorTagTrail: string;
}): Promise<string> {
  const payload = JSON.stringify([
    FINGERPRINT_VERSION,
    input.parentVertexId,
    input.depth,
    input.tag,
    input.role,
    input.text,
    input.parentTag,
    input.parentRole,
    input.parentTextHash,
    input.ancestorTagTrail,
  ]);
  return sha256Hex(payload);
}

function ensureEdge(graph: MergedTextGraph, parentId: string, childId: string): boolean {
  const existing = graph.childrenByParent[parentId] ?? [];
  if (existing.includes(childId)) {
    if (!graph.childrenByParent[parentId]) {
      graph.childrenByParent[parentId] = existing;
    }
    return false;
  }
  graph.childrenByParent[parentId] = [...existing, childId];
  return true;
}

export async function mergeTextTreeIntoGraph(
  graphInput: MergedTextGraph | null | undefined,
  tree: TextTreeNode,
  introducedLedgerSeq: number,
): Promise<{ graph: MergedTextGraph; stats: MergeTextTreeStats }> {
  const graph = normalizeMergedTextGraph(graphInput);
  const stats: MergeTextTreeStats = { verticesAdded: 0, edgesAdded: 0 };

  async function visit(
    node: TextTreeNode,
    parentVertexId: string,
    parentContext: ParentFingerprintContext | null,
    depth: number,
    ancestorTags: string[],
  ): Promise<void> {
    const text = normalizeVertexText(node.text ?? "");
    const tag = node.tag?.toLowerCase() ?? "";
    const role = node.role ? normalizeInlineText(node.role) : "";
    const ancestorTagTrail = ancestorTags.slice(-MAX_ANCESTOR_TAGS).join(">");
    const vertexId = await stableVertexFingerprint({
      parentVertexId,
      depth,
      tag,
      role,
      text,
      parentTag: parentContext?.tag ?? "",
      parentRole: parentContext?.role ?? "",
      parentTextHash: parentContext?.textHash ?? "",
      ancestorTagTrail,
    });
    const existing = graph.vertices[vertexId];
    if (!existing) {
      graph.vertices[vertexId] = {
        depth,
        text,
        tag: tag || undefined,
        role: role || undefined,
        introducedLedgerSeq,
      };
      stats.verticesAdded += 1;
    }
    if (ensureEdge(graph, parentVertexId, vertexId)) {
      stats.edgesAdded += 1;
    }
    const currentContext: ParentFingerprintContext = {
      tag,
      role,
      textHash: await sha256Hex(text),
    };
    const nextAncestorTags = tag ? [...ancestorTags, tag] : ancestorTags;
    for (let i = 0; i < node.children.length; i += 1) {
      await visit(node.children[i], vertexId, currentContext, depth + 1, nextAncestorTags);
    }
  }

  for (let i = 0; i < tree.children.length; i += 1) {
    await visit(tree.children[i], ROOT_VERTEX_ID, null, 0, []);
  }

  return { graph, stats };
}

export function removeVerticesIntroducedByLedgerSeq(
  graphInput: MergedTextGraph | null | undefined,
  seq: number,
): { graph: MergedTextGraph; removedVertexCount: number } {
  const graph = normalizeMergedTextGraph(graphInput);
  const removed = new Set<string>();
  for (const [vertexId, vertex] of Object.entries(graph.vertices)) {
    if (vertex.introducedLedgerSeq === seq) {
      removed.add(vertexId);
      delete graph.vertices[vertexId];
    }
  }
  if (removed.size === 0) {
    return { graph, removedVertexCount: 0 };
  }
  for (const [parentId, children] of Object.entries(graph.childrenByParent)) {
    const next = children.filter((childId) => !removed.has(childId));
    if (next.length > 0 || parentId === ROOT_VERTEX_ID) {
      graph.childrenByParent[parentId] = next;
    } else {
      delete graph.childrenByParent[parentId];
    }
  }
  return { graph, removedVertexCount: removed.size };
}

export function graphToDFSIndentedText(graphInput: MergedTextGraph | null | undefined): string {
  const graph = normalizeMergedTextGraph(graphInput);
  const lines: string[] = [];
  const roots = graph.childrenByParent[ROOT_VERTEX_ID] ?? [];

  function walk(vertexId: string): void {
    const vertex = graph.vertices[vertexId];
    if (!vertex) {
      return;
    }
    const prefix = "\t".repeat(Math.max(0, vertex.depth));
    if (vertex.text) {
      for (const segment of vertex.text.split("\n")) {
        const normalized = normalizeInlineText(segment);
        if (!normalized) {
          continue;
        }
        lines.push(`${prefix}${normalized}`);
      }
    }
    const children = graph.childrenByParent[vertexId] ?? [];
    for (const childId of children) {
      walk(childId);
    }
  }

  for (const vertexId of roots) {
    walk(vertexId);
  }
  return lines.join("\n");
}
