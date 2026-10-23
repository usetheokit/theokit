import { describe, expect, it } from "vitest";

import { createTurnRunner, type TurnAgent, type WithAgent } from "../src/control-plane/turn.js";

interface ClosingAgent {
  readonly agent: TurnAgent;
  readonly closes: () => number;
}

/** An agent whose run streams nothing and finishes, or whose `send` rejects; `close` is counted and may throw. */
function closingAgent(script: { readonly sendError?: Error; readonly closeError?: Error }): ClosingAgent {
  let closes = 0;
  const agent: TurnAgent = {
    async send() {
      if (script.sendError !== undefined) throw script.sendError;
      return {
        async *stream() {
          // The run streams no message; the turn's outcome comes from `wait()`.
        },
        wait: async () => ({ status: "finished" }),
      };
    },
    close() {
      closes += 1;
      if (script.closeError !== undefined) throw script.closeError;
    },
  };
  return { agent, closes: () => closes };
}

/** Hands the work the one agent, as `createContainer().withAgent` does with a built one. */
function withOnly(agent: TurnAgent): WithAgent {
  return (work) => work(agent);
}

describe("the turn closes its agent", () => {
  it("closes the agent once after a finished turn", async () => {
    const stub = closingAgent({});

    const outcome = await createTurnRunner(withOnly(stub.agent))("hello", () => undefined);

    expect(outcome).toEqual({ ok: true });
    expect(stub.closes()).toBe(1);
  });

  it("closes the agent once after a turn whose send rejects", async () => {
    const stub = closingAgent({ sendError: new Error("the model refused the request") });

    const outcome = await createTurnRunner(withOnly(stub.agent))("hello", () => undefined);

    expect(outcome).toEqual({ ok: false, code: "turn_failed", reason: "the model refused the request" });
    expect(stub.closes()).toBe(1);
  });

  it("a close that throws ends a finished turn with turn_failed", async () => {
    const stub = closingAgent({ closeError: new Error("the agent did not shut down") });

    const outcome = await createTurnRunner(withOnly(stub.agent))("hello", () => undefined);

    expect(outcome).toEqual({ ok: false, code: "turn_failed", reason: "the agent did not shut down" });
  });
});
