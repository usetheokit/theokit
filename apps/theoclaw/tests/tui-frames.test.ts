/**
 * B-376 — the TUI's pure reducer (`src/tui/frames.ts`): how a turn's frames become the transcript the
 * Ink view draws. Unit tests, no socket and no terminal; the PTY test in tui-app.test.tsx covers the
 * same reducer only through a running instance.
 */
import { describe, expect, it } from "vitest";

import type { ControlFrame } from "../src/control-client/control-client.js";
import { addNotice, applyFrame, failTurn, INITIAL_VIEW, nextSessionId, startTurn, type TuiView } from "../src/tui/frames.js";

const SESSION = "owner";

/** A turn event frame; the event's shape is the SDK translator's, so the test spells only its fields. */
function event(fields: Record<string, unknown>): ControlFrame {
  return { type: "event", session: SESSION, event: fields } as unknown as ControlFrame;
}

function fold(view: TuiView, frames: readonly ControlFrame[]): TuiView {
  return frames.reduce(applyFrame, view);
}

describe("startTurn", () => {
  it("appends the owner's message and marks a turn running", () => {
    const view = startTurn(INITIAL_VIEW, "hello");
    expect(view).toEqual({ transcript: [{ kind: "user", text: "hello" }], running: true });
    expect(INITIAL_VIEW.transcript).toEqual([]);
  });
});

describe("applyFrame: text deltas", () => {
  it("joins consecutive deltas into one assistant entry", () => {
    const view = fold(startTurn(INITIAL_VIEW, "hi"), [
      event({ type: "text_delta", content: "Hel" }),
      event({ type: "text_delta", content: "lo" }),
    ]);
    expect(view.transcript).toEqual([
      { kind: "user", text: "hi" },
      { kind: "assistant", text: "Hello" },
    ]);
  });

  it("starts a new assistant entry after a tool card", () => {
    const view = fold(startTurn(INITIAL_VIEW, "hi"), [
      event({ type: "text_delta", content: "before" }),
      event({ type: "tool_call", callId: "c1", toolName: "ReadFile" }),
      event({ type: "text_delta", content: "after" }),
    ]);
    expect(view.transcript.map((entry) => entry.kind)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(view.transcript.at(-1)).toEqual({ kind: "assistant", text: "after" });
  });

  it("does not merge a delta into the owner's message", () => {
    const view = applyFrame(startTurn(INITIAL_VIEW, "hi"), event({ type: "text_delta", content: "there" }));
    expect(view.transcript).toEqual([
      { kind: "user", text: "hi" },
      { kind: "assistant", text: "there" },
    ]);
  });
});

describe("applyFrame: tool cards", () => {
  it("draws a running card for a tool call", () => {
    const view = applyFrame(INITIAL_VIEW, event({ type: "tool_call", callId: "c1", toolName: "ReadFile" }));
    expect(view.transcript).toEqual([{ kind: "tool", callId: "c1", name: "ReadFile", status: "running" }]);
  });

  it("settles the matching card as success, leaving the other card running", () => {
    const view = fold(INITIAL_VIEW, [
      event({ type: "tool_call", callId: "c1", toolName: "ReadFile" }),
      event({ type: "tool_call", callId: "c2", toolName: "Grep" }),
      event({ type: "tool_result", callId: "c1", isError: false }),
    ]);
    expect(view.transcript).toEqual([
      { kind: "tool", callId: "c1", name: "ReadFile", status: "success" },
      { kind: "tool", callId: "c2", name: "Grep", status: "running" },
    ]);
  });

  it("settles a card as failed only when the result says isError: true", () => {
    const view = fold(INITIAL_VIEW, [
      event({ type: "tool_call", callId: "c1", toolName: "ReadFile" }),
      event({ type: "tool_result", callId: "c1", isError: true }),
    ]);
    expect(view.transcript).toEqual([{ kind: "tool", callId: "c1", name: "ReadFile", status: "failed" }]);
  });

  it("ignores a result whose call id matches no card", () => {
    const before = applyFrame(INITIAL_VIEW, event({ type: "tool_call", callId: "c1", toolName: "ReadFile" }));
    const after = applyFrame(before, event({ type: "tool_result", callId: "missing", isError: true }));
    expect(after.transcript).toEqual(before.transcript);
  });
});

describe("applyFrame: the end of a turn", () => {
  it("done stops the turn and keeps the transcript", () => {
    const running = startTurn(INITIAL_VIEW, "hi");
    const view = applyFrame(running, { type: "done", session: SESSION });
    expect(view).toEqual({ transcript: running.transcript, running: false });
  });

  it("interrupted stops the turn with a warning line", () => {
    const view = applyFrame(startTurn(INITIAL_VIEW, "hi"), { type: "interrupted", session: SESSION });
    expect(view.running).toBe(false);
    expect(view.transcript.at(-1)).toEqual({ kind: "notice", variant: "warning", text: "interrupted" });
  });

  it("an error frame stops the turn with an error line naming its code", () => {
    const view = applyFrame(startTurn(INITIAL_VIEW, "hi"), { type: "error", code: "busy", session: SESSION });
    expect(view.running).toBe(false);
    expect(view.transcript.at(-1)).toEqual({ kind: "notice", variant: "error", text: "the turn ended: busy" });
  });

  it("an error event inside the turn adds an error line and leaves the turn running", () => {
    const view = applyFrame(startTurn(INITIAL_VIEW, "hi"), event({ type: "error", code: "rate_limited" }));
    expect(view.running).toBe(true);
    expect(view.transcript.at(-1)).toEqual({ kind: "notice", variant: "error", text: "the turn failed (rate_limited)" });
  });
});

describe("applyFrame: frames that draw nothing", () => {
  it("returns the same view for interrupt_ok, no_turn and an unknown event type", () => {
    const running = startTurn(INITIAL_VIEW, "hi");
    for (const frame of [
      { type: "interrupt_ok", session: SESSION },
      { type: "no_turn", session: SESSION },
      event({ type: "usage", tokens: 12 }),
    ] as const) {
      expect(applyFrame(running, frame as ControlFrame)).toBe(running);
    }
  });
});

describe("addNotice and failTurn", () => {
  it("addNotice adds a line and leaves the running flag as it was", () => {
    const running = startTurn(INITIAL_VIEW, "hi");
    const view = addNotice(running, "warning", "no turn to interrupt");
    expect(view.running).toBe(true);
    expect(view.transcript.at(-1)).toEqual({ kind: "notice", variant: "warning", text: "no turn to interrupt" });
  });

  it("failTurn ends the running turn with the reason as an error line", () => {
    const view = failTurn(startTurn(INITIAL_VIEW, "hi"), "connection closed before the turn ended");
    expect(view.running).toBe(false);
    expect(view.transcript.at(-1)).toEqual({ kind: "notice", variant: "error", text: "connection closed before the turn ended" });
  });
});

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
