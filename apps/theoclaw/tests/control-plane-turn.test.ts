import { describe, expect, expectTypeOf, it } from "vitest";

import type { TurnAgent as ReplyTurnAgent, TurnRun as ReplyTurnRun } from "../src/channels/reply-handler.js";
import { createContainer } from "../src/composition.js";
import {
  createTurnRunner,
  runTheoClawTurn,
  type TurnAgent,
  type TurnEvent,
  type TurnRun,
} from "../src/control-plane/turn.js";

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
        cancel: async () => undefined,
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

/**
 * One agent container feeds both the `/control` turns and the chat replies, so both must read the
 * same agent port: two copies drift (the reply handler's `wait()` already carried `error.code`), and
 * a field one starts to need would compile against one and not the other. Checked by `typecheck`.
 */
describe("the agent port", () => {
  it("is one declaration for the control turns and the chat replies", () => {
    expectTypeOf<TurnRun>().toEqualTypeOf<ReplyTurnRun>();
    expectTypeOf<TurnAgent>().toEqualTypeOf<ReplyTurnAgent>();
  });
});

const text = (value: string) => ({ type: "assistant", message: { content: [{ type: "text", text: value }] } });

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Wait for a condition, never for a guessed duration (rules/testing.md § 3). */
async function waitFor(condition: () => boolean, what: string, deadlineMs = 1000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`within ${deadlineMs} ms: ${what} never happened`);
    await new Promise((settle) => setTimeout(settle, 5));
  }
}

interface CancellableScript {
  /** Held before `send` resolves, when given. */
  readonly sendGate?: Promise<void>;
  /** What `cancel()` does: resolve (default), reject, or never settle. */
  readonly cancel?: "resolve" | "reject" | "hang";
  /** After the first message the stream waits on this; `silent` never resolves it. */
  readonly afterFirst?: Promise<void> | "silent";
}

/** A run stub that records `cancel`, `return()` and every read, and keeps yielding after `afterFirst`. */
function cancellableAgent(script: CancellableScript) {
  const calls = { built: 0, cancels: 0, returns: 0, reads: 0 };
  const agent: TurnAgent = {
    async send() {
      if (script.sendGate !== undefined) await script.sendGate;
      const run: TurnRun = {
        stream() {
          let index = 0;
          return {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  calls.reads += 1;
                  index += 1;
                  if (index === 1) return { done: false, value: text("first") };
                  if (index === 2) {
                    if (script.afterFirst === "silent") await new Promise(() => undefined);
                    else await script.afterFirst;
                  }
                  return index <= 4 ? { done: false, value: text(`after-${index}`) } : { done: true, value: undefined };
                },
                async return() {
                  calls.returns += 1;
                  return { done: true, value: undefined };
                },
              };
            },
          };
        },
        wait: async () => ({ status: "finished" }),
        cancel() {
          calls.cancels += 1;
          if (script.cancel === "reject") return Promise.reject(new Error("the SDK refused to cancel"));
          if (script.cancel === "hang") return new Promise(() => undefined);
          return Promise.resolve();
        },
      };
      return run;
    },
  };
  const withAgent = <R>(work: (built: TurnAgent) => Promise<R>): Promise<R> => {
    calls.built += 1;
    return work(agent);
  };
  return { calls, withAgent, agent };
}

function startTurn(stub: ReturnType<typeof cancellableAgent>, signal: AbortSignal) {
  const events: TurnEvent[] = [];
  let firstEmitted = false;
  const outcome = runTheoClawTurn({
    withAgent: stub.withAgent,
    message: "hello",
    runId: "run-1",
    emit: (event) => {
      events.push(event);
      firstEmitted = true;
    },
    signal,
  });
  return { events, outcome, firstEmitted: () => firstEmitted };
}

/** AC-004 (B-368): a turn stops on its signal and cancels the SDK run (plan D2). */
describe("a turn cancelled through its signal", () => {
  it("an abort mid-stream calls the run's cancel once, emits nothing after it and resolves turn_cancelled", async () => {
    const gate = deferred();
    const stub = cancellableAgent({ afterFirst: gate.promise });
    const controller = new AbortController();
    const turn = startTurn(stub, controller.signal);
    await waitFor(turn.firstEmitted, "the first event");
    const emittedBeforeAbort = turn.events.length;

    controller.abort();
    gate.resolve();
    const outcome = await turn.outcome;

    expect(outcome).toMatchObject({ ok: false, code: "turn_cancelled" });
    expect(stub.calls.cancels).toBe(1);
    expect(turn.events.length).toBe(emittedBeforeAbort);
  });

  it("a signal already aborted builds no agent and resolves turn_cancelled", async () => {
    const stub = cancellableAgent({});
    const controller = new AbortController();
    controller.abort();

    const outcome = await startTurn(stub, controller.signal).outcome;

    expect(outcome).toMatchObject({ ok: false, code: "turn_cancelled" });
    expect(stub.calls.built).toBe(0);
  });

  it("a signal aborted while send is pending cancels the run once send resolves and reads nothing (EC-1)", async () => {
    const sendGate = deferred();
    const stub = cancellableAgent({ sendGate: sendGate.promise });
    const controller = new AbortController();
    const turn = startTurn(stub, controller.signal);
    await waitFor(() => stub.calls.built === 1, "the agent build");

    controller.abort();
    sendGate.resolve();
    const outcome = await turn.outcome;

    expect(outcome).toMatchObject({ ok: false, code: "turn_cancelled" });
    expect(stub.calls.cancels).toBe(1);
    expect(stub.calls.reads).toBe(0);
    expect(turn.events).toEqual([]);
  });

  it("a cancel that rejects still resolves turn_cancelled with the rejection in reason (EC-9)", async () => {
    const stub = cancellableAgent({ afterFirst: "silent", cancel: "reject" });
    const controller = new AbortController();
    const turn = startTurn(stub, controller.signal);
    await waitFor(turn.firstEmitted, "the first event");

    controller.abort();
    const outcome = await turn.outcome;

    expect(outcome).toMatchObject({ ok: false, code: "turn_cancelled" });
    expect(outcome.ok === false ? outcome.reason : "").toContain("the SDK refused to cancel");
  });

  it("an abort while next() is pending on a silent stream resolves turn_cancelled within 1000 ms", async () => {
    const stub = cancellableAgent({ afterFirst: "silent" });
    const controller = new AbortController();
    const turn = startTurn(stub, controller.signal);
    await waitFor(turn.firstEmitted, "the first event");
    let settled = false;
    void turn.outcome.then(() => {
      settled = true;
    });

    controller.abort();

    await waitFor(() => settled && stub.calls.cancels === 1, "turn_cancelled with the run cancelled once");
    await waitFor(() => stub.calls.returns === 1, "the stream iterator's return()");
    expect(await turn.outcome).toMatchObject({ ok: false, code: "turn_cancelled" });
  });

  it("a cancel that never settles does not hold the turn: turn_cancelled within 1000 ms", async () => {
    const stub = cancellableAgent({ afterFirst: "silent", cancel: "hang" });
    let teardowns = 0;
    const disposable = {
      send: (text: string) => stub.agent.send(text),
      async [Symbol.asyncDispose]() {
        teardowns += 1;
      },
    };
    // The real request boundary, so the agent's disposal runs as it does in production.
    const { withAgent } = createContainer<TurnAgent>({ factory: () => disposable });
    const controller = new AbortController();
    let firstEmitted = false;
    const outcome = runTheoClawTurn({
      withAgent,
      message: "hello",
      runId: "run-1",
      emit: () => {
        firstEmitted = true;
      },
      signal: controller.signal,
    });
    await waitFor(() => firstEmitted, "the first event");
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });

    controller.abort();

    await waitFor(() => settled, "the turn settling while cancel never does");
    // turn_failed here would mean the disposal threw: the request boundary turns that into the outcome.
    expect(await outcome).toMatchObject({ ok: false, code: "turn_cancelled" });
    expect(teardowns).toBe(1);
  });

  it("a disposal that throws after a cancelled turn fails it, as it fails a finished one", async () => {
    const stub = cancellableAgent({ afterFirst: "silent" });
    const controller = new AbortController();
    const events: TurnEvent[] = [];
    const outcome = runTheoClawTurn({
      withAgent: async (work) => {
        await stub.withAgent(work);
        throw new Error("the agent did not shut down");
      },
      message: "hello",
      runId: "run-1",
      emit: (event) => {
        events.push(event);
        controller.abort();
      },
      signal: controller.signal,
    });

    expect(await outcome).toEqual({ ok: false, code: "turn_failed", reason: "the agent did not shut down" });
    expect(stub.calls.cancels).toBe(1);
  });

  it("an emit that throws closes the run's stream and fails the turn", async () => {
    const stub = cancellableAgent({ afterFirst: "silent" });

    const outcome = await runTheoClawTurn({
      withAgent: stub.withAgent,
      message: "hello",
      runId: "run-1",
      emit: () => {
        throw new Error("the socket refused the frame");
      },
      signal: new AbortController().signal,
    });

    expect(outcome).toEqual({ ok: false, code: "turn_failed", reason: "the socket refused the frame" });
    expect(stub.calls.returns).toBe(1);
  });

  it("a turn with a signal that is never aborted ends ok and never cancels", async () => {
    const stub = cancellableAgent({ afterFirst: Promise.resolve() });

    const turn = startTurn(stub, new AbortController().signal);

    expect(await turn.outcome).toEqual({ ok: true });
    expect(stub.calls.cancels).toBe(0);
  });
});
