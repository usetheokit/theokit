/**
 * B-376 — the TUI's frame adapter (`src/tui/frames.ts`): how a turn's control frames become the
 * `AgentStreamSource` that `@theokit/tui`'s `agentStreamReducer` folds, and which frame-level notices
 * TheoClaw adds. Unit tests, no socket and no terminal.
 */
import { type AgentStreamEvent, agentStreamReducer, initialAgentStreamState } from "@theokit/tui";
import { describe, expect, it } from "vitest";

import type { ControlClient, ControlFrame } from "../src/control-client/control-client.js";
import { controlStream, nextSessionId, type TuiNotice } from "../src/tui/frames.js";

const SESSION = "owner";

/** A turn event frame; the event's shape is the SDK translator's, so the test spells only its fields. */
function event(fields: Record<string, unknown>): ControlFrame {
  return { type: "event", session: SESSION, event: fields } as unknown as ControlFrame;
}

async function run(frames: readonly ControlFrame[], fail?: Error) {
  const notices: TuiNotice[] = [];
  let ended = 0;
  const client = {
    chat: async function* () {
      yield* frames;
      if (fail !== undefined) throw fail;
    },
  } as unknown as ControlClient;
  const events: AgentStreamEvent[] = [];
  for await (const e of controlStream(client, "hi", SESSION, (n) => notices.push(n), () => (ended += 1))) events.push(e);
  // The hook folds a terminal done when the source ends.
  const state = [...events, { type: "done" }].reduce(agentStreamReducer, initialAgentStreamState);
  return { state, notices, ended };
}

describe("controlStream: text and tools fold through the framework reducer", () => {
  it("joins consecutive deltas into one assistant message", async () => {
    const { state } = await run([
      event({ type: "text_delta", content: "Hel" }),
      event({ type: "text_delta", content: "lo" }),
      { type: "done", session: SESSION },
    ]);
    expect(state.events).toMatchObject([{ kind: "message", role: "assistant", text: "Hello" }]);
    expect(state.status).toBe("done");
  });

  it("settles a tool as success, or as failed when the result says isError: true", async () => {
    const { state } = await run([
      event({ type: "tool_call", callId: "c1", toolName: "ReadFile" }),
      event({ type: "tool_call", callId: "c2", toolName: "Grep" }),
      event({ type: "tool_result", callId: "c1", isError: false }),
      event({ type: "tool_result", callId: "c2", isError: true }),
      { type: "done", session: SESSION },
    ]);
    expect(state.events).toMatchObject([
      { kind: "tool", name: "ReadFile", status: "success" },
      { kind: "tool", name: "Grep", status: "failed" },
    ]);
  });

  it("an interrupted turn keeps its text, fails the unfinished tool, and raises a warning", async () => {
    const { state, notices, ended } = await run([
      event({ type: "text_delta", content: "part" }),
      event({ type: "tool_call", callId: "c1", toolName: "ReadFile" }),
      { type: "interrupted", session: SESSION },
    ]);
    expect(state.events).toMatchObject([
      { kind: "message", text: "part" },
      { kind: "tool", status: "failed" },
    ]);
    expect(notices).toEqual([{ variant: "warning", text: "interrupted" }]);
    expect(ended).toBe(1);
  });
});

describe("controlStream: notices", () => {
  it("an error frame ends the turn with a notice naming its code", async () => {
    const { notices } = await run([{ type: "error", code: "busy", session: SESSION }]);
    expect(notices).toEqual([{ variant: "error", text: "the turn ended: busy" }]);
  });

  it("an error event inside the turn is a notice and the text after it still streams", async () => {
    const { state, notices } = await run([
      event({ type: "error", code: "rate_limited" }),
      event({ type: "text_delta", content: "after" }),
      { type: "done", session: SESSION },
    ]);
    expect(notices).toEqual([{ variant: "error", text: "the turn failed (rate_limited)" }]);
    expect(state.events).toMatchObject([{ kind: "message", text: "after" }]);
    expect(state.status).toBe("done");
  });

  it("a failed connection ends the turn with the reason", async () => {
    const { notices, ended } = await run([], new Error("connection closed before the turn ended"));
    expect(notices).toEqual([{ variant: "error", text: "connection closed before the turn ended" }]);
    expect(ended).toBe(1);
  });

  it("draws nothing for interrupt_ok, no_turn and an unknown event type", async () => {
    const { state, notices } = await run([
      { type: "interrupt_ok", session: SESSION },
      { type: "no_turn", session: SESSION },
      event({ type: "usage", tokens: 12 }),
      { type: "done", session: SESSION },
    ]);
    expect(state.events).toEqual([]);
    expect(notices).toEqual([]);
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
