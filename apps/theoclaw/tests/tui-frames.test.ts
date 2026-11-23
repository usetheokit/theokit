/**
 * B-376 — `/new`'s session id (`src/tui/frames.ts`).
 */
import { describe, expect, it } from "vitest";

import { nextSessionId } from "../src/tui/frames.js";

describe("nextSessionId", () => {
  it("appends -n to a short base", () => {
    expect(nextSessionId("owner", 2)).toBe("owner-2");
  });

  it("keeps a 64-character base within the 64-character limit by shortening the base", () => {
    const id = nextSessionId("a".repeat(64), 12);
    expect(id).toHaveLength(64);
    expect(id.endsWith("-12")).toBe(true);
  });

  it("leaves a base that fits exactly with its suffix unshortened", () => {
    const base = "b".repeat(62);
    expect(nextSessionId(base, 3)).toBe(`${base}-3`);
  });
});
