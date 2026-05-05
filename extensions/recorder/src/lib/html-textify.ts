const IGNORE_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "head",
  "nav",
  "footer",
]);
const BLOCK_TAGS = new Set([
  "div",
  "section",
  "article",
  "main",
  "aside",
  "header",
  "footer",
  "nav",
  "ul",
  "ol",
  "li",
  "p",
  "table",
  "tr",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
const MAX_DEPTH = 5;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function indentByDepth(depth: number): string {
  if (depth <= 0) {
    return "";
  }
  return "--".repeat(Math.min(depth, MAX_DEPTH)) + " ";
}

function stripIndentPrefix(value: string): string {
  return value.replace(/^(?:--)+\s/, "");
}

function visibleElementChildren(node: Element): Element[] {
  return Array.from(node.children).filter(
    (child) =>
      !IGNORE_TAGS.has(child.tagName.toLowerCase()) && child.tagName.toLowerCase() !== "meta",
  );
}

function collectInlineText(node: Element): string {
  const parts: string[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = normalizeText(child.textContent ?? "");
      if (text) {
        parts.push(text);
      }
      continue;
    }
    if (!(child instanceof Element)) {
      continue;
    }
    const tag = child.tagName.toLowerCase();
    if (IGNORE_TAGS.has(tag) || BLOCK_TAGS.has(tag)) {
      continue;
    }
    const text = normalizeText(child.textContent ?? "");
    if (text) {
      parts.push(text);
    }
  }
  return normalizeText(parts.join(" "));
}

function isTransparentWrapper(node: Element): boolean {
  if (node.tagName.toLowerCase() !== "div") {
    return false;
  }
  const ownText = collectInlineText(node);
  if (ownText) {
    return false;
  }
  const children = visibleElementChildren(node);
  return children.length === 1 && children[0].tagName.toLowerCase() === "div";
}

function collectLines(node: Element, depth: number): string[] {
  const tag = node.tagName.toLowerCase();
  if (IGNORE_TAGS.has(tag)) {
    return [];
  }
  if (isTransparentWrapper(node)) {
    return collectLines(visibleElementChildren(node)[0], depth);
  }

  const ownText = collectInlineText(node);
  const children = visibleElementChildren(node);
  const childGroups = children
    .map((child) => collectLines(child, ownText ? depth + 1 : depth))
    .filter((group) => group.length > 0);

  const lines: string[] = [];
  if (ownText) {
    lines.push(`${indentByDepth(depth)}${ownText}`);
  }

  if (childGroups.length === 0) {
    if (!ownText) {
      const fullText = normalizeText(node.textContent ?? "");
      if (fullText) {
        lines.push(`${indentByDepth(depth)}${fullText}`);
      }
    }
    return lines;
  }

  if (!ownText) {
    const simpleChildren = childGroups.every(
      (group) => group.length === 1 && group[0].trim().length > 0,
    );
    if (simpleChildren) {
      const [first, ...rest] = childGroups.map((group) => group[0].trim());
      lines.push(`${indentByDepth(depth)}${first}`);
      for (const value of rest) {
        lines.push(`${indentByDepth(depth + 1)}${value}`);
      }
      return lines;
    }
    if (childGroups.length > 1 && childGroups[0].length === 1) {
      lines.push(`${indentByDepth(depth)}${stripIndentPrefix(childGroups[0][0].trim())}`);
      for (let i = 1; i < childGroups.length; i += 1) {
        for (const line of childGroups[i]) {
          if (!line.trim()) {
            continue;
          }
          lines.push(`${indentByDepth(depth + 1)}${stripIndentPrefix(line.trim())}`);
        }
      }
      return lines;
    }
  }

  for (let i = 0; i < childGroups.length; i += 1) {
    if (i > 0 && depth === 0) {
      lines.push("");
    }
    lines.push(...childGroups[i]);
  }
  return lines;
}

export function transformHtmlToIndentedText(htmlContent?: string): string {
  if (!htmlContent || !htmlContent.trim()) {
    return "";
  }
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(htmlContent, "text/html");
  } catch {
    return normalizeText(htmlContent);
  }
  const roots = Array.from((doc.body ?? doc.documentElement).children);
  const groups = roots.map((root) => collectLines(root, 0)).filter((group) => group.length > 0);
  const merged: string[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    if (i > 0) {
      merged.push("");
    }
    merged.push(...groups[i]);
  }
  return merged.join("\n");
}
