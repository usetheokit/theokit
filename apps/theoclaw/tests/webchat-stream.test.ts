import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createContainer } from "../src/composition.js";
import { createTurnRunner, type TurnAgent, type TurnRun } from "../src/control-plane/turn.js";
import { createWebchatRun } from "../src/webchat/create-run.js";
import { TheoClawConfigError } from "../src/control-plane/errors.js";
import { createWebchatRoutes, MAX_CHAT_BODY_BYTES } from "../src/webchat/routes.js";

const TOKEN = "w".repeat(40);
const ASSETS = mkdtempSync(join(tmpdir(), "theoclaw-webchat-stream-"));

type SdkStub = { readonly type: string; readonly [key: string]: unknown };

const text = (value: string): SdkStub => ({ type: "assistant", message: { content: [{ type: "text", text: value }] } });
const streamedFailure: SdkStub = { type: "status", status: "ERROR", message: "the model run failed" };
const finished: SdkStub = { type: "status", status: "FINISHED" };

// The framework's presenter writes the unmasked cause of a failed turn to console.error (B-322).
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
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

interface StubScript {
  /** What the run streams, per sent message. */
  readonly messages: (sent: string) => readonly SdkStub[];
  /** After the first message the stream waits on this; `silent` never resolves it. */
  readonly afterFirst?: Promise<void> | "silent";
  readonly status?: string;
  /** Called when the first message is handed to the turn. */
  readonly onFirstMessage?: () => void;
}

/** A turn runner over the real request boundary, whose agents follow `script`; counts builds and cancels. */
function stubRunner(script: StubScript) {
  const calls = { built: 0, cancels: 0 };
  const factory = (): TurnAgent => {
    calls.built += 1;
    return {
      async send(sent: string): Promise<TurnRun> {
        const messages = script.messages(sent);
        return {
          async *stream() {
            for (const [index, message] of messages.entries()) {
              if (index === 0) script.onFirstMessage?.();
              yield message;
              if (index === 0 && script.afterFirst === "silent") await new Promise(() => undefined);
              if (index === 0 && script.afterFirst !== undefined) await script.afterFirst;
            }
          },
          wait: async () => ({ status: script.status ?? "finished" }),
          cancel: async () => {
            calls.cancels += 1;
          },
        };
      },
    };
  };
  const runTurn = createTurnRunner(createContainer<TurnAgent>({ factory }).withAgent);
  return { calls, runTurn };
}

function chatRequest(body: unknown, token: string = TOKEN): Request {
  return new Request("http://127.0.0.1/webchat/chat", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The `data:` payloads of an SSE body, the `[DONE]` frame kept as the string. */
function dataFrames(body: string): unknown[] {
  return body
    .split("\n\n")
    .flatMap((frame) => frame.split("\n").filter((line) => line.startsWith("data: ")))
    .map((line) => line.slice("data: ".length))
    .map((data) => (data === "[DONE]" ? data : (JSON.parse(data) as unknown)));
}

/**
 * Read the body until a text chunk arrives. The presenter's `start` frame comes before the turn has
 * produced anything, so the first read alone says nothing about the model's output.
 */
async function readUntilText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes('"type":"text-delta"')) {
    const { done, value } = await reader.read();
    if (done) throw new Error("the body ended before any text chunk");
    seen += decoder.decode(value, { stream: true });
  }
}

function chunksOfType(frames: unknown[], type: string): { readonly [key: string]: unknown }[] {
  return frames.filter(
    (frame): frame is { readonly [key: string]: unknown } =>
      typeof frame === "object" && frame !== null && (frame as { type?: unknown }).type === type,
  );
}

/** AC-003 (B-368): an authorized turn streams through generateAgentRoutes, with no SSE written in the app. */
describe("POST /webchat/chat", () => {
  it("answers 401 with a Bearer challenge to a missing or wrong token and builds 0 agents", async () => {
    const stub = stubRunner({ messages: () => [text("never")] });
    const handle = createWebchatRoutes({ token: TOKEN, runTurn: stub.runTurn, assetsDir: ASSETS });
    const unauthenticated = new Request("http://127.0.0.1/webchat/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hi" }),
    });

    for (const request of [unauthenticated, chatRequest({ message: "hi" }, "x".repeat(40))]) {
      const response = await handle(request);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    }
    expect(stub.calls.built).toBe(0);
  });

  it("streams a stub agent's text as text/event-stream with at least one text chunk", async () => {
    const stub = stubRunner({ messages: () => [text("hello from the agent")] });
    const handle = createWebchatRoutes({ token: TOKEN, runTurn: stub.runTurn, assetsDir: ASSETS });

    const response = await handle(chatRequest({ message: "hi" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const frames = dataFrames(await response.text());
    const deltas = chunksOfType(frames, "text-delta").map((chunk) => chunk.delta);
    expect(deltas.join("")).toBe("hello from the agent");
    expect(frames.at(-1)).toBe("[DONE]");
  });

  // LCR0121: the routes own the gate, so they refuse a token below the bearer minimum themselves.
  it("refuses a token shorter than 32 characters with a config error naming THEOCLAW_WEBCHAT_TOKEN", () => {
    const stub = stubRunner({ messages: () => [text("never")] });
    const build = () => createWebchatRoutes({ token: "short", runTurn: stub.runTurn, assetsDir: ASSETS });

    expect(build).toThrow(TheoClawConfigError);
    expect(build).toThrow(/THEOCLAW_WEBCHAT_TOKEN must be at least 32 characters/);
  });

  // F-dom-4: /control caps a frame at 64 KiB; the chat post is bounded the same way.
  it("answers 413 to a body over the chat bound and builds 0 agents", async () => {
    const stub = stubRunner({ messages: () => [text("never")] });
    const handle = createWebchatRoutes({ token: TOKEN, runTurn: stub.runTurn, assetsDir: ASSETS });

    const response = await handle(chatRequest({ message: "x".repeat(MAX_CHAT_BODY_BYTES) }));

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(stub.calls.built).toBe(0);
  });

  it("streams a body of exactly the chat bound", async () => {
    const stub = stubRunner({ messages: () => [text("at the bound")] });
    const handle = createWebchatRoutes({ token: TOKEN, runTurn: stub.runTurn, assetsDir: ASSETS });
    const padding = MAX_CHAT_BODY_BYTES - JSON.stringify({ message: "" }).length;

    const response = await handle(chatRequest({ message: "y".repeat(padding) }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("at the bound");
  });

  it("ends a turn whose runner rejects with one turn_failed error chunk, then the terminal frame", async () => {
    const runTurn = async (): Promise<never> => {
      throw new Error("the runner broke");
    };
    const handle = createWebchatRoutes({ token: TOKEN, runTurn, assetsDir: ASSETS });

    const body = await (await handle(chatRequest({ message: "hi" }))).text();

    const frames = dataFrames(body);
    expect(chunksOfType(frames, "error")).toHaveLength(1);
    expect(body).toContain("turn_failed");
    expect(frames.at(-1)).toBe("[DONE]");
  });

  it("streams no reply text for a request whose signal was already aborted", async () => {
    const stub = stubRunner({ messages: () => [text("should not stream")] });
    const handle = createWebchatRoutes({ token: TOKEN, runTurn: stub.runTurn, assetsDir: ASSETS });
    const left = new AbortController();
    left.abort();
    const request = new Request(chatRequest({ message: "hi" }), { signal: left.signal });

    const body = await (await handle(request)).text();

    expect(chunksOfType(dataFrames(body), "text-delta")).toHaveLength(0);
    expect(body).not.toContain("should not stream");
  });

  it("answers 400 to a body without message and builds 0 agents", async () => {
    const stub = stubRunner({ messages: () => [text("never")] });
    const handle = createWebchatRoutes({ token: TOKEN, runTurn: stub.runTurn, assetsDir: ASSETS });

    const response = await handle(chatRequest({ text: "no message field" }));

    expect(response.status).toBe(400);
    expect(stub.calls.built).toBe(0);
  });

  it("ends a turn that failed without a streamed error with one turn_failed error chunk, then the terminal frame", async () => {
    const stub = stubRunner({ messages: () => [], status: "error" });
    const handle = createWebchatRoutes({ token: TOKEN, runTurn: stub.runTurn, assetsDir: ASSETS });

    const body = await (await handle(chatRequest({ message: "hi" }))).text();

    const frames = dataFrames(body);
    expect(chunksOfType(frames, "error")).toHaveLength(1);
    expect(body).toContain("turn_failed");
    expect(frames.at(-1)).toBe("[DONE]");
  });

  it("ends a turn that streamed its own error with that error chunk only, then the terminal frame", async () => {
    const stub = stubRunner({ messages: () => [streamedFailure] });
    const handle = createWebchatRoutes({ token: TOKEN, runTurn: stub.runTurn, assetsDir: ASSETS });

    const body = await (await handle(chatRequest({ message: "hi" }))).text();

    const frames = dataFrames(body);
    expect(chunksOfType(frames, "error")).toHaveLength(1);
    expect(body).not.toContain("turn_failed");
    expect(frames.at(-1)).toBe("[DONE]");
  });

  it("delivers the first text byte within 500 ms of the stub's first message", async () => {
    const gate = deferred();
    let firstMessageAt = 0;
    const stub = stubRunner({
      messages: () => [text("first"), text("second")],
      afterFirst: gate.promise,
      onFirstMessage: () => {
        firstMessageAt = Date.now();
      },
    });
    const handle = createWebchatRoutes({ token: TOKEN, runTurn: stub.runTurn, assetsDir: ASSETS });

    const response = await handle(chatRequest({ message: "hi" }));
    const reader = response.body!.getReader();
    await readUntilText(reader);
    const firstByteAt = Date.now();
    gate.resolve();
    await reader.cancel();

    expect(firstMessageAt).toBeGreaterThan(0);
    expect(firstByteAt - firstMessageAt).toBeLessThan(500);
  });
});

describe("cancelling a WebChat turn", () => {
  it("a turn whose answer streamed to its end is not cancelled when the presenter stops reading at done", async () => {
    const stub = stubRunner({ messages: () => [text("the whole answer"), finished] });
    const outcomes: Promise<unknown>[] = [];
    const handle = createWebchatRoutes({
      token: TOKEN,
      runTurn: (message, emit, signal) => {
        const outcome = stub.runTurn(message, emit, signal);
        outcomes.push(outcome);
        return outcome;
      },
      assetsDir: ASSETS,
    });

    const frames = dataFrames(await (await handle(chatRequest({ message: "hi" }))).text());

    expect(frames.at(-1)).toBe("[DONE]");
    expect(await outcomes[0]).toEqual({ ok: true });
    expect(stub.calls.cancels).toBe(0);
  });

  it("cancelling the response body on a silent turn cancels the run within 1000 ms (EC-2)", async () => {
    const stub = stubRunner({ messages: () => [text("first"), text("never sent")], afterFirst: "silent" });
    const handle = createWebchatRoutes({ token: TOKEN, runTurn: stub.runTurn, assetsDir: ASSETS });
    const response = await handle(chatRequest({ message: "hi" }));
    const reader = response.body!.getReader();
    await readUntilText(reader);

    await reader.cancel();

    await waitFor(() => stub.calls.cancels === 1, "the run's cancel");
  });

  it("return() on the source resolves at once on a silent turn (EC-2)", async () => {
    const stub = stubRunner({ messages: () => [text("first"), text("never sent")], afterFirst: "silent" });
    const source = createWebchatRun(stub.runTurn, new AbortController().signal)("hi", "session-1");
    const iterator = source[Symbol.asyncIterator]();
    await iterator.next();
    const pending = iterator.next();
    let settled = false;
    const returned = iterator.return!().then((result) => {
      settled = true;
      return result;
    });

    await waitFor(() => settled, "return() settling");
    expect(await returned).toEqual({ done: true, value: undefined });
    expect(await pending).toEqual({ done: true, value: undefined });
    await waitFor(() => stub.calls.cancels === 1, "the run's cancel");
  });

  it("two concurrent posts each stream only their own reply, and aborting one leaves the other complete (EC-6)", async () => {
    const stub = stubRunner({ messages: (sent) => [text(`reply to ${sent}`)] });
    const slowStub = stubRunner({ messages: () => [text("slow reply"), text("never sent")], afterFirst: "silent" });
    const handle = createWebchatRoutes({
      token: TOKEN,
      runTurn: (message, emit, signal) =>
        message === "slow" ? slowStub.runTurn(message, emit, signal) : stub.runTurn(message, emit, signal),
      assetsDir: ASSETS,
    });

    const [slow, fast] = await Promise.all([handle(chatRequest({ message: "slow" })), handle(chatRequest({ message: "fast" }))]);
    const slowReader = slow.body!.getReader();
    await readUntilText(slowReader);
    await slowReader.cancel();
    const fastFrames = dataFrames(await fast.text());

    const fastText = chunksOfType(fastFrames, "text-delta")
      .map((chunk) => chunk.delta)
      .join("");
    expect(fastText).toBe("reply to fast");
    expect(fastFrames.at(-1)).toBe("[DONE]");
    expect(stub.calls.built + slowStub.calls.built).toBe(2);
    await waitFor(() => slowStub.calls.cancels === 1, "the aborted turn's cancel");
    expect(stub.calls.cancels).toBe(0);
  });
});
