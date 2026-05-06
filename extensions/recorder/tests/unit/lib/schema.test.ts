import { describe, it, expect } from "vitest";
import { STORAGE_KEYS } from "../../../src/lib/schema";

describe("STORAGE_KEYS", () => {
  it("exposes state and settings keys", () => {
    expect(STORAGE_KEYS.state).toBe("recorder:state");
    expect(STORAGE_KEYS.settings).toBe("recorder:settings");
  });
});
