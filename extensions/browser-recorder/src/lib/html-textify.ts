const IGNORE_TAGS = new Set(["head", "meta", "link", "script", "style", "noscript"]);
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function decodeEntities(value: string): string {
  const decodedNamed = value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

  return decodedNamed
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    );
}

function parseTagName(token: string): string | null {
  const match = token.match(/^<\/?\s*([a-zA-Z0-9:-]+)/);
  return match ? match[1].toLowerCase() : null;
}

function normalizeText(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

export function transformHtmlToIndentedText(htmlContent?: string): string {
  if (!htmlContent || !htmlContent.trim()) {
    return "";
  }

  const tokens = htmlContent.match(/<!--[\s\S]*?-->|<\/?[^>]+>|[^<]+/g);
  if (!tokens) {
    return normalizeText(htmlContent);
  }

  let ignoredDepth = 0;
  const textParts: string[] = [];

  const emitText = (text: string): void => {
    const normalized = normalizeText(text);
    if (!normalized) {
      return;
    }
    textParts.push(normalized);
  };

  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<!")) {
      continue;
    }

    if (!token.startsWith("<")) {
      if (ignoredDepth === 0) {
        emitText(token);
      }
      continue;
    }

    const tagName = parseTagName(token);
    if (!tagName) {
      continue;
    }

    const isClosingTag = /^<\s*\//.test(token);
    const isSelfClosing = /\/\s*>$/.test(token) || VOID_TAGS.has(tagName);

    if (IGNORE_TAGS.has(tagName)) {
      if (isClosingTag) {
        ignoredDepth = Math.max(0, ignoredDepth - 1);
      } else if (!isSelfClosing) {
        ignoredDepth += 1;
      }
      continue;
    }

    if (ignoredDepth > 0) {
      continue;
    }

    if (isClosingTag || tagName === "br" || !isSelfClosing) {
      continue;
    }
  }

  return textParts.join("\n");
}
