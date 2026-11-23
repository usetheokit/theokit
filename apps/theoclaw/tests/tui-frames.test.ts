/**
 * B-376 — the TUI's frame helpers (`src/tui/frames.ts`). The stream adapter is covered in tui-stream.test.ts
 * and the rendered turn in tui-app.test.tsx.
 *
 * The local reducer these tests once covered (applyFrame, startTurn, addNotice, failTurn) is gone with the
 * move to the framework's `agentStreamReducer`. Where its cases live now:
 * - delta joining, a new message after a tool card, running/success/failed cards, a result with an unknown
 *   call id, done, an error frame, an error event inside the turn, and frames that draw nothing: the
 *   "controlStream" describes in tui-stream.test.ts;
 * - an interrupted turn: tui-stream.test.ts (tool cancelled, "Interrupted by user") and tui-app.test.tsx;
 * - the owner's message (a separate item, never merged into a reply) and the running flag: tui-app.test.tsx;
 * - addNotice and failTurn: notices from the app and a failed connection, in tui-stream.test.ts.
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
