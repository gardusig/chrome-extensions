import { describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../../../src/lib/schema";

describe("STORAGE_KEYS", () => {
  it("exposes expected storage key names", () => {
    expect(STORAGE_KEYS.state).toBe("recorder:state");
    expect(STORAGE_KEYS.pages).toBe("recorder:pages");
    expect(STORAGE_KEYS.requests).toBe("recorder:requests");
    expect(STORAGE_KEYS.settings).toBe("recorder:settings");
    expect(STORAGE_KEYS.hostIndex).toBe("recorder:host-index");
  });
});
