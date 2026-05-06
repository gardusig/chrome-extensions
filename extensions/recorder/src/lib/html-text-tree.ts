export type TextTreeNode = {
  text: string;
  tag?: string;
  role?: string;
  children: TextTreeNode[];
};

const IGNORE_SUBTREES = new Set(["script", "style", "noscript", "template", "head", "svg"]);

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMultilineText(value: string): string {
  const lines = value
    .split("\n")
    .map((line) => normalizeInlineText(line))
    .filter((line) => line.length > 0);
  return lines.join("\n");
}

function appendUnique(values: string[], seen: Set<string>, value: string | undefined): void {
  if (!value) {
    return;
  }
  const normalized = normalizeInlineText(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  values.push(normalized);
}

function directTextFromElement(node: Element): string {
  const pieces: string[] = [];
  const seen = new Set<string>();

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      appendUnique(pieces, seen, child.textContent ?? "");
      continue;
    }
    if (!(child instanceof Element)) {
      continue;
    }
    const tag = child.tagName.toLowerCase();
    if (tag === "br") {
      pieces.push("\n");
    }
  }

  appendUnique(pieces, seen, node.getAttribute("aria-label") ?? undefined);
  appendUnique(pieces, seen, node.getAttribute("title") ?? undefined);
  if (node.tagName.toLowerCase() === "img") {
    appendUnique(pieces, seen, node.getAttribute("alt") ?? undefined);
  }

  return normalizeMultilineText(pieces.join(" "));
}

function walk(node: Element): TextTreeNode | null {
  const tag = node.tagName.toLowerCase();
  if (IGNORE_SUBTREES.has(tag)) {
    return null;
  }

  const children: TextTreeNode[] = [];
  for (const child of Array.from(node.children)) {
    const next = walk(child);
    if (next) {
      children.push(next);
    }
  }

  const text = directTextFromElement(node);
  if (!text && children.length === 0) {
    return null;
  }

  return {
    text,
    tag,
    role: node.getAttribute("role") ?? undefined,
    children,
  };
}

export function htmlToTextTree(rawHtml: string): TextTreeNode {
  try {
    const doc = new DOMParser().parseFromString(rawHtml, "text/html");
    const root = doc.body ?? doc.documentElement;
    const children: TextTreeNode[] = [];
    for (const child of Array.from(root.children)) {
      const node = walk(child);
      if (node) {
        children.push(node);
      }
    }
    return { text: "", tag: "root", children };
  } catch {
    const text = normalizeInlineText(rawHtml);
    return { text, tag: "root", children: [] };
  }
}

function compressNode(node: TextTreeNode): TextTreeNode | null {
  const children = node.children
    .map((child) => compressNode(child))
    .filter((child): child is TextTreeNode => child !== null);
  const text = normalizeMultilineText(node.text);

  if (!text && children.length === 0) {
    return null;
  }
  if (!text && children.length === 1) {
    return children[0];
  }
  return { ...node, text, children };
}

export function compressTextTree(root: TextTreeNode): TextTreeNode {
  const children = root.children
    .map((child) => compressNode(child))
    .filter((child): child is TextTreeNode => child !== null);
  const text = normalizeMultilineText(root.text);
  return { ...root, text, children };
}

function pushLine(lines: string[], depth: number, text: string): void {
  const normalized = normalizeMultilineText(text);
  if (!normalized) {
    return;
  }
  const prefix = depth <= 0 ? "" : `${"--".repeat(depth)} `;
  for (const segment of normalized.split("\n")) {
    lines.push(`${prefix}${segment}`);
  }
}

function walkToLines(node: TextTreeNode, depth: number, lines: string[]): void {
  if (node.text) {
    pushLine(lines, depth, node.text);
  }
  for (const child of node.children) {
    walkToLines(child, depth + 1, lines);
  }
}

export function treeToIndentedText(root: TextTreeNode): string {
  const lines: string[] = [];
  for (const child of root.children) {
    walkToLines(child, 0, lines);
  }
  return lines.join("\n");
}
