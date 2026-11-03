/**
 * B-400 T1.2 (FR-003, FR-004, NFR-002): a finished control or WebChat turn reports its usage record
 * in its final frame or event and writes one usage line, carrying no configured value.
 */
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { createContainer } from "../src/composition.js";
import { controlOptions } from "../src/control-plane/control-wiring.js";
import { type ControlPlaneHandle, healthHandler, listenControlPlane } from "../src/control-plane/listener.js";
import { createTurnRunner, type TurnAgent, type TurnEvent, type TurnOutcome } from "../src/control-plane/turn.js";
import { createWebchatRun } from "../src/webchat/create-run.js";
import { assistant, DisposableFake, type FakeTurn, finished, waitFor } from "./fakes.js";

const TOKEN = "control-token-for-the-usage-line-tests-3b1";
const MODEL = "stub/model";
const SECRET = "sk-usage-line-secret-0123456789";

const priced = (inputTokens: number, outputTokens: number, amountUsd: number | undefined): FakeTurn => ({
  frames: [assistant("ok"), finished()],
  result: { status: "finished", usage: { inputTokens, outputTokens }, cost: { amountUsd } },
});

const planes: ControlPlaneHandle[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const plane of planes.splice(0)) await plane.close();
});

async function startPlane(
  turnFor: (n: number) => FakeTurn,
  options: { readonly model?: string; readonly secrets?: readonly string[] } = {},
): Promise<{ readonly handle: ControlPlaneHandle; readonly stderr: string[] }> {
  const stderr: string[] = [];
  let builds = 0;
  let turns = 0;
  const withAgent = createContainer<TurnAgent>({ factory: () => new DisposableFake(turnFor(turns++)) }).withAgent;
  const handle = await listenControlPlane({
    handler: healthHandler,
    port: 0,
    host: "127.0.0.1",
    control: controlOptions(
      TOKEN,
      withAgent,
      async () => new DisposableFake(turnFor(builds++)),
      (line) => void stderr.push(line),
      options.secrets ?? [],
      undefined,
      options.model ?? MODEL,
    ),
    stderr: (line) => void stderr.push(line),
  });
  planes.push(handle);
  return { handle, stderr };
}

interface Peer {
  readonly frames: Array<Record<string, unknown>>;
  send(frame: unknown): void;
}

async function peer(handle: ControlPlaneHandle): Promise<Peer> {
  const { host, port } = handle.address();
  const socket = new WebSocket(`ws://${host}:${port}/control`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  sockets.push(socket);
  socket.on("error", () => undefined);
  const frames: Array<Record<string, unknown>> = [];
  socket.on("message", (raw) => void frames.push(JSON.parse(String(raw)) as Record<string, unknown>));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("unexpected-response", (_r, response) => reject(new Error(`upgrade answered ${response.statusCode}`)));
  });
  return { frames, send: (frame) => socket.send(JSON.stringify(frame)) };
}

const doneFrame = (frames: Array<Record<string, unknown>>) => frames.find((frame) => frame.type === "done");
const usageLines = (stderr: readonly string[]) => stderr.filter((line) => line.startsWith("theoclaw: usage "));

describe("the usage line (FR-004)", () => {
  it("a finished turn writes one usage line naming the surface and the model", async () => {
    const plane = await startPlane(() => priced(12, 3, 0.001));
    const client = await peer(plane.handle);

    client.send({ type: "chat", message: "hello" });
    await waitFor(() => doneFrame(client.frames) !== undefined, 2000, "the done frame");

    await waitFor(() => usageLines(plane.stderr).length === 1, 2000, "the usage line");
    expect(usageLines(plane.stderr)).toEqual([`theoclaw: usage control ${MODEL} in=12 out=3 cost=$0.001`]);
  });

  it("a finished session turn writes one usage line and its done frame carries the record", async () => {
    const plane = await startPlane(() => priced(7, 5, undefined));
    const client = await peer(plane.handle);

    client.send({ type: "chat", message: "hello", session: "owner" });
    await waitFor(() => doneFrame(client.frames) !== undefined, 2000, "the done frame");

    expect(doneFrame(client.frames)).toEqual({
      type: "done",
      session: "owner",
      usage: { inputTokens: 7, outputTokens: 5 },
      model: MODEL,
      costUnpriced: true,
    });
    await waitFor(() => usageLines(plane.stderr).length === 1, 2000, "the usage line");
    expect(usageLines(plane.stderr)).toEqual([`theoclaw: usage control ${MODEL} in=7 out=5 cost=unpriced`]);
  });

  it("a failed turn writes no usage line", async () => {
    const plane = await startPlane(() => ({ ...priced(1, 1, 0.1), result: { status: "error" } }));
    const client = await peer(plane.handle);

    client.send({ type: "chat", message: "hello" });
    await waitFor(() => client.frames.some((frame) => frame.type === "error"), 2000, "the error frame");

    expect(usageLines(plane.stderr)).toEqual([]);
  });

  it("the usage line carries no configured secret", async () => {
    const plane = await startPlane(() => priced(1, 1, 0.1), { model: `vendor/${SECRET}`, secrets: [SECRET] });
    const client = await peer(plane.handle);

    client.send({ type: "chat", message: "hello" });
    client.send({ type: "chat", message: "hello", session: "s1" });
    await waitFor(() => usageLines(plane.stderr).length === 1, 2000, "the sessionless usage line");
    client.send({ type: "chat", message: "again", session: "s1" });
    await waitFor(() => usageLines(plane.stderr).length === 2, 2000, "the session usage line");

    expect(usageLines(plane.stderr)).toHaveLength(2);
    for (const line of plane.stderr) expect(line).not.toContain(SECRET);
    expect(JSON.stringify(client.frames)).not.toContain(SECRET);
  });

  it("two session turns on two sockets finishing together each get their own record (concurrent test)", async () => {
    const plane = await startPlane((n) => priced(100 + n, 200 + n, undefined));
    const [first, second] = [await peer(plane.handle), await peer(plane.handle)];

    first.send({ type: "chat", message: "a", session: "s0" });
    second.send({ type: "chat", message: "b", session: "s1" });
    await waitFor(() => doneFrame(first.frames) !== undefined && doneFrame(second.frames) !== undefined, 2000, "both done frames");

    const records = [doneFrame(first.frames), doneFrame(second.frames)].map((frame) => frame!.usage as { inputTokens: number; outputTokens: number });
    // Each frame carries the tokens of one run, never a mix or a sum of two (atomic-counter invariant).
    for (const usage of records) expect(usage.outputTokens - usage.inputTokens).toBe(100);
    expect(new Set(records.map((usage) => usage.inputTokens))).toEqual(new Set([100, 101]));
    expect(usageLines(plane.stderr)).toHaveLength(2);
  });
});

describe("the WebChat done event (FR-003)", () => {
  it("carries the usage, the cost and the model, and writes one usage line", async () => {
    const lines: string[] = [];
    const withAgent = createContainer<TurnAgent>({ factory: () => new DisposableFake(priced(9, 4, 0.002)) }).withAgent;
    const runTurn = createTurnRunner(withAgent, [], MODEL);
    const source = createWebchatRun(runTurn, new AbortController().signal, (line) => void lines.push(line))("hi", "s");

    const events: Array<Record<string, unknown>> = [];
    for await (const event of source) events.push(event as unknown as Record<string, unknown>);

    const done = events.find((event) => event.type === "done");
    expect(done).toMatchObject({ usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 }, cost: 0.002, model: MODEL });
    expect(lines).toEqual([`theoclaw: usage webchat ${MODEL} in=9 out=4 cost=$0.002`]);
  });

  it("an unpriced WebChat turn carries no cost on its done event", async () => {
    const withAgent = createContainer<TurnAgent>({ factory: () => new DisposableFake(priced(9, 4, undefined)) }).withAgent;
    const source = createWebchatRun(createTurnRunner(withAgent, [], MODEL), new AbortController().signal, () => undefined)("hi", "s");

    const events: Array<Record<string, unknown>> = [];
    for await (const event of source) events.push(event as unknown as Record<string, unknown>);

    const done = events.find((event) => event.type === "done");
    expect(done).toMatchObject({ usage: { inputTokens: 9, outputTokens: 4 }, model: MODEL });
    expect(done).not.toHaveProperty("cost");
  });
});

describe("the WebChat done held for the turn's usage", () => {
  const delta = (content: string) => ({ type: "text_delta", content }) as unknown as TurnEvent;
  const done = { type: "done", result: "", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 1 } as unknown as TurnEvent;
  const usage = { inputTokens: 3, outputTokens: 2, model: MODEL, costUsd: 0.1 };

  async function eventsOf(outcome: TurnOutcome): Promise<Array<Record<string, unknown>>> {
    const runTurn = async (_message: string, emit: (event: TurnEvent) => void): Promise<TurnOutcome> => {
      emit(delta("a"));
      emit(done);
      emit(delta("b"));
      return outcome;
    };
    const events: Array<Record<string, unknown>> = [];
    for await (const event of createWebchatRun(runTurn, new AbortController().signal)("hi", "s")) {
      events.push(event as unknown as Record<string, unknown>);
    }
    return events;
  }

  it("keeps the events after the done behind it", async () => {
    const events = await eventsOf({ ok: true, usage });
    expect(events.map((event) => event.type === "done" ? "done" : event.content)).toEqual(["a", "done", "b"]);
    expect(events[1]).toMatchObject({ usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }, cost: 0.1, model: MODEL });
  });

  it("a failed turn after its done delivers the done, unchanged, before the error", async () => {
    const events = await eventsOf({ ok: false, code: "turn_failed", reason: "the run ended with status error" });
    expect(events.map((event) => event.type)).toEqual(["text_delta", "done", "text_delta", "error"]);
    expect(events[1]).not.toHaveProperty("model");
  });
});
