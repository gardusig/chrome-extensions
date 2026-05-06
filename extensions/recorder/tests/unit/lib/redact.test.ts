import { describe, expect, it } from "vitest";
import {
  redactHeaders,
  redactObjectValues,
  redactUrl,
  truncateText,
} from "../../../src/lib/redact";

describe("redactHeaders", () => {
  it("returns undefined when no headers are provided", () => {
    expect(redactHeaders(undefined)).toBeUndefined();
  });

  it("redacts sensitive headers and keeps regular headers", () => {
    const result = redactHeaders([
      { name: "Authorization", value: "Bearer abc123" },
      { name: "Content-Type", value: "application/json" },
      { name: "x-api-key", value: "secret-value" },
    ]);

    expect(result).toEqual([
      { name: "Authorization", value: "[REDACTED]" },
      { name: "Content-Type", value: "application/json" },
      { name: "x-api-key", value: "[REDACTED]" },
    ]);
  });

  it("falls back to unknown when header name is missing", () => {
    const result = redactHeaders([{ value: "abc" } as unknown as chrome.webRequest.HttpHeader]);
    expect(result).toEqual([{ name: "unknown", value: "abc" }]);
  });
});

describe("redactObjectValues", () => {
  it("redacts sensitive object keys recursively", () => {
    const input = {
      email: "user@example.com",
      token: "abc",
      nested: {
        password: "123",
        allowed: "ok",
      },
      items: [{ apiKey: "hidden" }, { value: "safe" }],
    };

    const result = redactObjectValues(input);

    expect(result).toEqual({
      email: "user@example.com",
      token: "[REDACTED]",
      nested: {
        password: "[REDACTED]",
        allowed: "ok",
      },
      items: [{ apiKey: "[REDACTED]" }, { value: "safe" }],
    });
  });

  it("redacts bearer and token strings", () => {
    const value = "Authorization: Bearer my-token";
    expect(redactObjectValues(value)).toContain("Bearer [REDACTED]");
  });

  it("redacts token keyword strings", () => {
    const value = "Token xyz123";
    expect(redactObjectValues(value)).toContain("Token [REDACTED]");
  });

  it("keeps primitive non-string values unchanged", () => {
    expect(redactObjectValues(42)).toBe(42);
    expect(redactObjectValues(true)).toBe(true);
    expect(redactObjectValues(null)).toBeNull();
  });
});

describe("redactUrl", () => {
  it("redacts sensitive query params and keeps regular ones", () => {
    const redacted = redactUrl("https://example.com/path?token=abc&id=1");
    expect(redacted).toContain("token=%5BREDACTED%5D");
    expect(redacted).toContain("id=1");
  });

  it("returns original value for invalid urls", () => {
    expect(redactUrl("not a valid url")).toBe("not a valid url");
  });

  it("redacts multiple sensitive keys and preserves path", () => {
    const redacted = redactUrl("https://example.com/a/b?password=abc&apikey=1&foo=bar");
    expect(redacted.startsWith("https://example.com/a/b?")).toBe(true);
    expect(redacted).toContain("password=%5BREDACTED%5D");
    expect(redacted).toContain("apikey=%5BREDACTED%5D");
    expect(redacted).toContain("foo=bar");
  });
});

describe("truncateText", () => {
  it("keeps short text unchanged", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  it("truncates long text with an informative suffix", () => {
    const result = truncateText("abcdefghij", 5);
    expect(result).toContain("abcde");
    expect(result).toContain("[TRUNCATED 5 chars]");
  });
});
