import { request } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { createContainer } from "../src/composition.js";
import { TheoClawConfigError } from "../src/control-plane/errors.js";
import { type ControlPlaneHandle, healthHandler, listenControlPlane } from "../src/control-plane/listener.js";
import { createTurnRunner, type TurnAgent } from "../src/control-plane/turn.js";

const TOKEN = "control-token-for-the-socket-tests-7c41"; // 39 characters

type SdkStub = { readonly type: string; readonly [key: string]: unknown };

interface Deferred {
  readonly promise: Promise<void>;
  open(): void;
}

function deferred(): Deferred {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const text = (value: string): SdkStub => ({ type: "assistant", message: { content: [{ type: "text", text: value }] } });
const finished: SdkStub = { type: "status", status: "FINISHED" };
const failedStatus: SdkStub = { type: "status", status: "ERROR", message: "the model run failed" };

interface StubScript {
  readonly messages: readonly SdkStub[];
  /** Status `wait()` resolves with. Default `finished`. */
  readonly status?: string;
  /** Awaited after the first message is yielded, before the rest. */
  readonly gate?: Deferred;
  /** `send` rejects with this instead of starting a run. */
  readonly sendError?: Error;
  /** Called right before the first message is yielded. */
  readonly onFirstYield?: () => void;
}

function stubAgent(script: StubScript): TurnAgent {
  return {
    async send() {
      if (script.sendError !== undefined) throw script.sendError;
      return {
        async *stream() {
          for (const [index, message] of script.messages.entries()) {
            if (index === 0) script.onFirstYield?.();
            yield message;
            if (index === 0 && script.gate !== undefined) await script.gate.promise;
          }
        },
        wait: async () => ({ status: script.status ?? "finished" }),
        cancel: async () => undefined,
      };
    },
  };
}

const stderrLines: string[] = [];
let handle: ControlPlaneHandle | undefined;
let builtAgents = 0;
let settled: Promise<unknown>[] = [];
const clients: WebSocket[] = [];

/** A control plane whose agents follow `scripts` in order, one per turn. */
async function startPlane(scripts: StubScript[], token: string = TOKEN): Promise<ControlPlaneHandle> {
  const agents = createContainer<TurnAgent>({
    factory: () => {
      const script = scripts[builtAgents] ?? scripts[scripts.length - 1]!;
      builtAgents += 1;
      return stubAgent(script);
    },
  });
  const runner = createTurnRunner(agents.withAgent);
  const runTurn: typeof runner = (message, emit) => {
    const outcome = runner(message, emit);
    settled.push(outcome);
    return outcome;
  };
  handle = await listenControlPlane({
    handler: healthHandler,
    port: 0,
    host: "127.0.0.1",
    control: { token, runTurn },
    stderr: (line) => void stderrLines.push(line),
  });
  return handle;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  if (handle !== undefined) {
    await handle.close();
    expect(handle.server.listening).toBe(false);
    handle = undefined;
  }
  await Promise.allSettled(settled);
  settled = [];
  builtAgents = 0;
  stderrLines.length = 0;
});

interface Client {
  readonly socket: WebSocket;
  readonly frames: Array<Record<string, unknown>>;
  /** Resolves with the frames once `predicate` holds over them; fails naming what never arrived. */
  until(predicate: (frames: Array<Record<string, unknown>>) => boolean, what: string): Promise<Array<Record<string, unknown>>>;
  send(frame: unknown): void;
}

async function connect(path = "/control", authorization = `Bearer ${TOKEN}`): Promise<Client> {
  const { host, port } = handle!.address();
  const socket = new WebSocket(`ws://${host}:${port}${path}`, { headers: { Authorization: authorization } });
  clients.push(socket);
  socket.on("error", () => undefined);
  const frames: Array<Record<string, unknown>> = [];
  const waiters: Array<() => void> = [];
  socket.on("message", (raw) => {
    frames.push(JSON.parse(String(raw)) as Record<string, unknown>);
    for (const wake of waiters.splice(0)) wake();
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("unexpected-response", (_request, response) => reject(new Error(`upgrade answered ${response.statusCode}`)));
  });
  return {
    socket,
    frames,
    send: (frame) => socket.send(JSON.stringify(frame)),
    until: async (predicate, what) => {
      const deadline = Date.now() + 2_000;
      while (!predicate(frames)) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`never received ${what}; frames: ${JSON.stringify(frames)}`);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, left);
          waiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      return frames;
    },
  };
}

/** The status an upgrade attempt was answered with, read from a raw HTTP request. */
function upgradeStatus(path: string, authorization?: string): Promise<number | undefined> {
  const { host, port } = handle!.address();
  const headers: Record<string, string> = {
    Connection: "Upgrade",
    Upgrade: "websocket",
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
  };
  if (authorization !== undefined) headers.Authorization = authorization;
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path, headers });
    req.on("response", (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on("upgrade", (_response, socket) => {
      socket.destroy();
      reject(new Error("the upgrade was accepted"));
    });
    req.on("error", reject);
    req.end();
  });
}

const finalFrames = (frames: Array<Record<string, unknown>>) =>
  frames.filter((frame) => frame.type === "done" || (frame.type === "error" && frame.code === "turn_failed"));
const turnEnded = (frames: Array<Record<string, unknown>>) => finalFrames(frames).length > 0;

async function connections(): Promise<number> {
  return new Promise((resolve, reject) =>
    handle!.server.getConnections((error, count) => (error ? reject(error) : resolve(count))),
  );
}

/** AC-004 (B-372): /control refuses before any agent exists and runs one turn per chat frame. */
describe("the /control socket", () => {
  it("refuses an upgrade without the control token and never builds the agent", async () => {
    await startPlane([{ messages: [text("hi"), finished] }]);

    expect(await upgradeStatus("/control")).toBe(401);
    expect(builtAgents).toBe(0);
  });

  it("refuses an upgrade with a wrong control token and never builds the agent", async () => {
    await startPlane([{ messages: [text("hi"), finished] }]);

    expect(await upgradeStatus("/control", `Bearer ${TOKEN}x`)).toBe(401);
    expect(await upgradeStatus("/control", "Basic abc")).toBe(401);
    expect(builtAgents).toBe(0);
  });

  it("refuses an upgrade on any path but /control", async () => {
    await startPlane([{ messages: [text("hi"), finished] }]);

    expect(await upgradeStatus("/other", `Bearer ${TOKEN}`)).toBe(404);
    expect(await upgradeStatus("/control/x", `Bearer ${TOKEN}`)).toBe(404);
    expect(builtAgents).toBe(0);
  });

  it("answers 404 to every upgrade when the control token is unset", async () => {
    handle = await listenControlPlane({ handler: healthHandler, port: 0, host: "127.0.0.1", stderr: () => undefined });

    expect(await upgradeStatus("/control", `Bearer ${TOKEN}`)).toBe(404);
  });

  it("accepts the control token with the scheme written bearer", async () => {
    await startPlane([{ messages: [text("hi"), finished] }]);

    const client = await connect("/control", `bearer ${TOKEN}`);
    client.send({ type: "chat", message: "hello" });
    await client.until(turnEnded, "the end of the turn");
  });

  it("streams a stub agent's events as JSON frames ending in done", async () => {
    await startPlane([{ messages: [text("first"), text("second"), finished] }]);
    const client = await connect();

    client.send({ type: "chat", message: "hello" });
    const frames = await client.until(turnEnded, "the end of the turn");

    const texts = frames
      .filter((frame) => frame.type === "event")
      .map((frame) => frame.event as Record<string, unknown>)
      .filter((event) => event.type === "text_delta")
      .map((event) => event.content);
    expect(texts).toEqual(["first", "second"]);
    expect(frames.at(-1)).toEqual({ type: "done" });
    expect(builtAgents).toBe(1);
  });

  it("a successful turn ends with exactly one final frame, done", async () => {
    await startPlane([{ messages: [text("hi"), finished] }]);
    const client = await connect();

    client.send({ type: "chat", message: "hello" });
    const frames = await client.until(turnEnded, "the end of the turn");

    const enveloped = frames.filter((frame) => frame.type === "event").map((frame) => frame.event as { type: string });
    expect(enveloped.map((event) => event.type)).toContain("done");
    expect(finalFrames(frames)).toEqual([{ type: "done" }]);
  });

  it("a stream carrying status ERROR ends with exactly one final frame, turn_failed", async () => {
    await startPlane([{ messages: [text("partial"), failedStatus] }]);
    const client = await connect();

    client.send({ type: "chat", message: "hello" });
    const frames = await client.until(turnEnded, "the end of the turn");

    const enveloped = frames.filter((frame) => frame.type === "event").map((frame) => frame.event as { type: string; code?: string });
    expect(enveloped).toContainEqual(expect.objectContaining({ type: "error", code: "AGENT_ERROR" }));
    expect(finalFrames(frames)).toEqual([{ type: "error", code: "turn_failed" }]);
  });

  it("answers turn_failed and keeps the socket open when the turn fails", async () => {
    await startPlane([{ messages: [text("partial")], status: "error" }, { messages: [text("again"), finished] }]);
    const client = await connect();

    client.send({ type: "chat", message: "hello" });
    await client.until(turnEnded, "the failed turn's end");
    expect(finalFrames(client.frames)).toEqual([{ type: "error", code: "turn_failed" }]);

    client.send({ type: "chat", message: "once more" });
    await client.until((frames) => finalFrames(frames).length === 2, "the second turn's end");
    expect(finalFrames(client.frames)[1]).toEqual({ type: "done" });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("answers turn_failed when the stream carried an error and wait reports finished", async () => {
    await startPlane([{ messages: [failedStatus], status: "finished" }]);
    const client = await connect();

    client.send({ type: "chat", message: "hello" });
    const frames = await client.until(turnEnded, "the end of the turn");

    expect(finalFrames(frames)).toEqual([{ type: "error", code: "turn_failed" }]);
  });

  it("answers turn_failed when the agent refuses the message", async () => {
    await startPlane([{ messages: [], sendError: new Error("send refused") }]);
    const client = await connect();

    client.send({ type: "chat", message: "hello" });
    const frames = await client.until(turnEnded, "the end of the turn");

    expect(finalFrames(frames)).toEqual([{ type: "error", code: "turn_failed" }]);
    expect(stderrLines.join("\n")).toContain("send refused");
  });

  it("answers bad_frame to a frame that is not a chat frame", async () => {
    await startPlane([{ messages: [text("hi"), finished] }]);
    const client = await connect();

    client.socket.send("not json");
    client.send({ type: "chat" });
    client.send({ type: "chat", message: "" });
    client.send({ type: "other", message: "hello" });
    const frames = await client.until((all) => all.length === 4, "four replies");

    expect(frames).toEqual(Array(4).fill({ type: "error", code: "bad_frame" }));
    expect(builtAgents).toBe(0);
  });

  it("answers bad_frame to a binary frame carrying chat JSON and builds no agent", async () => {
    await startPlane([{ messages: [text("hi"), finished] }]);
    const client = await connect();

    client.socket.send(Buffer.from(JSON.stringify({ type: "chat", message: "hello" })), { binary: true });
    const frames = await client.until((all) => all.length === 1, "one reply");

    expect(frames).toEqual([{ type: "error", code: "bad_frame" }]);
    expect(builtAgents).toBe(0);
  });

  it("answers busy to a chat frame during a turn", async () => {
    const gate = deferred();
    await startPlane([{ messages: [text("first"), finished], gate }]);
    const client = await connect();

    client.send({ type: "chat", message: "hello" });
    await client.until((frames) => frames.some((frame) => frame.type === "event"), "the first event");
    client.send({ type: "chat", message: "too soon" });
    await client.until((frames) => frames.some((frame) => frame.code === "busy"), "the busy reply");
    gate.open();
    await client.until(turnEnded, "the end of the turn");

    expect(builtAgents).toBe(1);
  });

  it("a busy reply during a turn is followed by that turn's own done", async () => {
    const gate = deferred();
    await startPlane([{ messages: [text("first"), finished], gate }]);
    const client = await connect();

    client.send({ type: "chat", message: "hello" });
    await client.until((frames) => frames.some((frame) => frame.type === "event"), "the first event");
    client.send({ type: "chat", message: "too soon" });
    await client.until((frames) => frames.some((frame) => frame.code === "busy"), "the busy reply");
    gate.open();
    const frames = await client.until(turnEnded, "the end of the turn");

    const busyAt = frames.findIndex((frame) => frame.code === "busy");
    expect(finalFrames(frames)).toEqual([{ type: "done" }]);
    expect(frames.indexOf(finalFrames(frames)[0]!)).toBeGreaterThan(busyAt);
  });

  it("sends the first event frame within 500 ms of the stub's first message", async () => {
    let firstYieldAt = 0;
    await startPlane([{ messages: [text("hi"), finished], onFirstYield: () => (firstYieldAt = performance.now()) }]);
    const client = await connect();
    let firstFrameAt = 0;
    client.socket.once("message", () => (firstFrameAt = performance.now()));

    client.send({ type: "chat", message: "hello" });
    await client.until(turnEnded, "the end of the turn");

    expect(firstFrameAt).toBeGreaterThan(0);
    expect(firstFrameAt - firstYieldAt).toBeLessThan(500);
  });

  it("a refused upgrade leaves 0 open connections", async () => {
    await startPlane([{ messages: [text("hi"), finished] }]);

    expect(await upgradeStatus("/control", "Bearer wrong")).toBe(401);
    const deadline = Date.now() + 2_000;
    let open = await connections();
    while (open > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve));
      open = await connections();
    }
    expect(open, `open connections after the refusal: ${open}`).toBe(0);
  });

  it("prints no token over a refused upgrade and an accepted socket turn", async () => {
    await startPlane([{ messages: [], sendError: new Error("send refused") }]);

    await upgradeStatus("/control", `Bearer ${TOKEN}-wrong`);
    const client = await connect();
    client.send({ type: "chat", message: "hello" });
    await client.until(turnEnded, "the end of the turn");

    expect(stderrLines.length).toBeGreaterThan(0);
    expect(stderrLines.join("\n")).not.toContain(TOKEN);
  });

  it("a socket closed mid-turn leaves the process listening and the next socket runs a turn", async () => {
    const gate = deferred();
    await startPlane([{ messages: [text("first"), finished], gate }, { messages: [text("second"), finished] }]);
    const first = await connect();

    first.send({ type: "chat", message: "hello" });
    await first.until((frames) => frames.some((frame) => frame.type === "event"), "the first event");
    first.socket.terminate();
    // The server side must see the close before the turn goes on, so its remaining frames meet a
    // closed socket and are dropped (EC-1) instead of racing the close.
    const deadline = Date.now() + 2_000;
    while ((await connections()) > 0 && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
    expect(await connections()).toBe(0);
    gate.open();
    await Promise.all(settled);

    const second = await connect();
    second.send({ type: "chat", message: "again" });
    const frames = await second.until(turnEnded, "the second socket's turn end");
    expect(finalFrames(frames)).toEqual([{ type: "done" }]);
    expect(handle!.server.listening).toBe(true);
  });

  it("a frame over 65536 bytes closes that socket with 1009 and the process keeps listening", async () => {
    await startPlane([{ messages: [text("hi"), finished] }]);
    const client = await connect();
    const closed = new Promise<number>((resolve) => client.socket.once("close", (code) => resolve(code)));

    client.socket.send("x".repeat(65_537));

    expect(await closed).toBe(1009);
    const { host, port } = handle!.address();
    expect((await fetch(`http://${host}:${port}/health`)).status).toBe(200);
    expect(stderrLines.join("\n")).toContain("control socket error");
  });

  it("refuses a control token shorter than 32 characters without printing it", async () => {
    const shortToken = "short-token-for-the-listener-x1"; // 31 characters
    const attempt = startPlane([{ messages: [] }], shortToken);

    await expect(attempt).rejects.toThrow(TheoClawConfigError);
    await expect(attempt).rejects.not.toThrow(shortToken);
    expect(stderrLines.join("\n")).not.toContain(shortToken);
    handle = undefined;
  });

  it("accepts a control token of exactly 32 characters", async () => {
    const token = "t".repeat(32);
    await startPlane([{ messages: [text("hi"), finished] }], token);

    const client = await connect("/control", `Bearer ${token}`);
    client.send({ type: "chat", message: "hello" });
    await client.until(turnEnded, "the end of the turn");
  });

  it("answers turn_failed and frees the socket when the runner itself rejects", async () => {
    handle = await listenControlPlane({
      handler: healthHandler,
      port: 0,
      host: "127.0.0.1",
      control: { token: TOKEN, runTurn: () => Promise.reject(new Error("runner broke")) },
      stderr: (line) => void stderrLines.push(line),
    });
    const client = await connect();

    client.send({ type: "chat", message: "hello" });
    await client.until(turnEnded, "the first turn's end");
    client.send({ type: "chat", message: "again" });
    await client.until((frames) => finalFrames(frames).length === 2, "the second turn's end");

    expect(client.frames.every((frame) => frame.code === "turn_failed")).toBe(true);
    expect(stderrLines.join("\n")).toContain("runner broke");
  });
});
