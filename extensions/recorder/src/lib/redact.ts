type SimpleHeader = { name?: string; value?: string };

const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "password",
  "secret",
  "apikey",
  "api-key",
  "x-api-key",
];

const REDACTED = "[REDACTED]";

function shouldRedactKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitiveKey) => lower.includes(sensitiveKey));
}

export function truncateText(value: string, maxLength = 20_000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...[TRUNCATED ${value.length - maxLength} chars]`;
}

export function redactHeaders(
  headers: chrome.webRequest.HttpHeader[] | SimpleHeader[] | undefined,
): SimpleHeader[] | undefined {
  if (!headers) {
    return undefined;
  }

  return headers.map((header) => {
    const name = header.name ?? "unknown";
    if (shouldRedactKey(name)) {
      return { name, value: REDACTED };
    }
    return { name, value: header.value };
  });
}

export function redactObjectValues<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactObjectValues(entry)) as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (shouldRedactKey(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = redactObjectValues(nestedValue);
      }
    }
    return result as T;
  }
  if (typeof value === "string") {
    return value.replace(/\b(Bearer|Token)\s+[a-zA-Z0-9\-._~+/]+=*/g, `${"$1"} ${REDACTED}`) as T;
  }
  return value;
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of parsed.searchParams.keys()) {
      if (shouldRedactKey(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
