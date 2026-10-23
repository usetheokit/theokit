import { describe, expect, it } from "vitest";

import { createContainer } from "../src/composition.js";
import { createTurnRunner, type TurnAgent } from "../src/control-plane/turn.js";

interface DisposableAgent {
  readonly agent: TurnAgent;
  /** How many times the agent's real teardown ran. */
  readonly teardowns: () => number;
}

/**
 * An agent shaped like `@theokit/sdk` 5.11's `Agent`: `close()` only marks it disposed, and
 * `[Symbol.asyncDispose]()` runs the teardown unless that mark is already set. A turn that calls
 * `close()` therefore skips the teardown, which is the leak this file guards against.
 */
function sdkShapedAgent(script: { readonly sendError?: Error; readonly disposeError?: Error }): DisposableAgent {
  let disposed = false;
  let teardowns = 0;
  const agent = {
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
      disposed = true;
    },
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      teardowns += 1;
      if (script.disposeError !== undefined) throw script.disposeError;
    },
  };
  return { agent, teardowns: () => teardowns };
}

/** The runner the control socket gets: one request boundary per turn, as `startTheoClaw` builds it. */
function runnerFor(stub: DisposableAgent) {
  return createTurnRunner(createContainer<TurnAgent>({ factory: () => stub.agent }).withAgent);
}

describe("the turn's request boundary tears its agent down", () => {
  it("runs the agent's teardown once after a finished turn", async () => {
    const stub = sdkShapedAgent({});

    const outcome = await runnerFor(stub)("hello", () => undefined);

    expect(outcome).toEqual({ ok: true });
    expect(stub.teardowns()).toBe(1);
  });

  it("runs the agent's teardown once after a turn whose send rejects", async () => {
    const stub = sdkShapedAgent({ sendError: new Error("the model refused the request") });

    const outcome = await runnerFor(stub)("hello", () => undefined);

    expect(outcome).toEqual({ ok: false, code: "turn_failed", reason: "the model refused the request" });
    expect(stub.teardowns()).toBe(1);
  });

  it("a teardown that throws ends a finished turn with turn_failed", async () => {
    const stub = sdkShapedAgent({ disposeError: new Error("the agent did not shut down") });

    const outcome = await runnerFor(stub)("hello", () => undefined);

    expect(outcome).toMatchObject({ ok: false, code: "turn_failed" });
  });
});
