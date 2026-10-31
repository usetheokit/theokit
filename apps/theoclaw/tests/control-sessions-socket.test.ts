/**
 * B-376 T2.3 — the `/control` socket speaks sessions and interrupt: real listeners and real sockets
 * over session agents that are fakes. Split from `control-sessions.test.ts`, which keeps the store.
 */
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { createContainer } from "../src/composition.js";
import { controlOptions } from "../src/control-plane/control-wiring.js";
import { type ControlPlaneHandle, healthHandler, listenControlPlane } from "../src/control-plane/listener.js";
import type { TurnAgent } from "../src/control-plane/turn.js";
import { assistant, deferred, DisposableFake, type FakeTurn, finished, waitFor } from "./fakes.js";

const quick: FakeTurn = { frames: [assistant("ok"), finished()] };

const SOCKET_TOKEN = "control-token-for-the-session-tests-9e2f";

interface Plane {
  readonly handle: ControlPlaneHandle;
  readonly agents: DisposableFake[];
  readonly stderr: string[];
  builds: () => number;
}

let planes: ControlPlaneHandle[] = [];
let sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const plane of planes.splice(0)) await plane.close();
});

/** A listener whose session agents follow `turnFor(n)`; `buildGate(n)` holds the nth build. */
async function startSessionPlane(
  turnFor: (n: number) => FakeTurn,
  buildGate: (n: number) => Promise<void> | undefined = () => undefined,
): Promise<Plane> {
  const agents: DisposableFake[] = [];
  const stderr: string[] = [];
  let builds = 0;
  const withAgent = createContainer<TurnAgent>({ factory: () => new DisposableFake(quick) }).withAgent;
  const handle = await listenControlPlane({
    handler: healthHandler,
    port: 0,
    host: "127.0.0.1",
    control: controlOptions(
      SOCKET_TOKEN,
      withAgent,
      async () => {
        const n = builds;
        builds += 1;
        const gate = buildGate(n);
        if (gate !== undefined) await gate;
        const agent = new DisposableFake(turnFor(n));
        agents.push(agent);
        return agent;
      },
      (line) => void stderr.push(line),
    ),
    stderr: (line) => void stderr.push(line),
  });
  planes.push(handle);
  return { handle, agents, stderr, builds: () => builds };
}

interface Peer {
  readonly socket: WebSocket;
  readonly frames: Array<Record<string, unknown>>;
  send(frame: unknown): void;
  until(predicate: (frames: Array<Record<string, unknown>>) => boolean, what: string): Promise<void>;
}

async function peer(plane: Plane): Promise<Peer> {
  const { host, port } = plane.handle.address();
  const socket = new WebSocket(`ws://${host}:${port}/control`, { headers: { Authorization: `Bearer ${SOCKET_TOKEN}` } });
  sockets.push(socket);
  socket.on("error", () => undefined);
  const frames: Array<Record<string, unknown>> = [];
  socket.on("message", (raw) => void frames.push(JSON.parse(String(raw)) as Record<string, unknown>));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("unexpected-response", (_r, response) => reject(new Error(`upgrade answered ${response.statusCode}`)));
  });
  return {
    socket,
    frames,
    send: (frame) => socket.send(JSON.stringify(frame)),
    until: (predicate, what) => waitFor(() => predicate(frames), 2000, `${what}; frames: ${JSON.stringify(frames)}`),
  };
}

const hasType = (type: string) => (frames: Array<Record<string, unknown>>) => frames.some((f) => f.type === type);
const closeSocket = (socket: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });

describe("the control socket speaks sessions and interrupt (T2.3)", () => {
  it("every frame of a session turn names its session", async () => {
    const plane = await startSessionPlane(() => ({ frames: [assistant("hi"), finished()], deltas: ["h"] }));
    const client = await peer(plane);
    client.send({ type: "chat", message: "hello", session: "owner" });
    await client.until(hasType("done"), "the done frame");
    expect(client.frames.length).toBeGreaterThan(1);
    expect(client.frames.every((f) => f.session === "owner")).toBe(true);
  });

  it("an interrupt from another socket gets interrupt_ok and the owner gets interrupted", async () => {
    const hold = deferred<void>();
    const plane = await startSessionPlane(() => ({ frames: [assistant("x")], before: hold.promise }));
    const [ownerSocket, other] = [await peer(plane), await peer(plane)];
    ownerSocket.send({ type: "chat", message: "hello", session: "owner" });
    await waitFor(() => plane.agents[0]?.signals.length === 1, 2000, "the send");
    other.send({ type: "interrupt", session: "owner" });
    await other.until(hasType("interrupt_ok"), "interrupt_ok");
    await ownerSocket.until(hasType("interrupted"), "interrupted");
    expect(ownerSocket.frames.at(-1)).toEqual({ type: "interrupted", session: "owner" });
    expect(other.frames).toEqual([{ type: "interrupt_ok", session: "owner" }]);
  });

  it("a chat frame on a busy session from another socket gets busy", async () => {
    const hold = deferred<void>();
    const plane = await startSessionPlane(() => ({ frames: [assistant("x"), finished()], before: hold.promise }));
    const [first, second] = [await peer(plane), await peer(plane)];
    first.send({ type: "chat", message: "a", session: "s1" });
    await waitFor(() => plane.agents[0]?.signals.length === 1, 2000, "the send");
    second.send({ type: "chat", message: "b", session: "s1" });
    await second.until(hasType("error"), "busy");
    expect(second.frames).toEqual([{ type: "error", code: "busy", session: "s1" }]);
    hold.resolve();
    await first.until(hasType("done"), "done");
  });

  it("an interrupt with no running turn gets no_turn, and an invalid session id gets bad_frame", async () => {
    const plane = await startSessionPlane(() => quick);
    const client = await peer(plane);
    client.send({ type: "interrupt", session: "idle" });
    await client.until(hasType("no_turn"), "no_turn");
    client.send({ type: "chat", message: "hi", session: "not valid!" });
    await client.until(hasType("error"), "bad_frame");
    expect(client.frames).toEqual([
      { type: "no_turn", session: "idle" },
      { type: "error", code: "bad_frame", session: "not valid!" },
    ]);
    expect(plane.builds()).toBe(0);
  });

  it("one socket cannot run a second turn on another session while its first runs", async () => {
    const hold = deferred<void>();
    const plane = await startSessionPlane(() => ({ frames: [assistant("x"), finished()], before: hold.promise }));
    const client = await peer(plane);
    client.send({ type: "chat", message: "a", session: "a" });
    await waitFor(() => plane.agents[0]?.signals.length === 1, 2000, "the send");
    client.send({ type: "chat", message: "b", session: "b" });
    await client.until(hasType("error"), "busy");
    expect(client.frames.find((f) => f.type === "error")).toMatchObject({ code: "busy" });
    expect(plane.builds()).toBe(1);
    hold.resolve();
    await client.until(hasType("done"), "done");
  });

  it("closing the socket of a session turn aborts its signal", async () => {
    const plane = await startSessionPlane(() => ({ frames: [assistant("x")], before: new Promise<void>(() => undefined) }));
    const client = await peer(plane);
    client.send({ type: "chat", message: "a", session: "s1" });
    await waitFor(() => plane.agents[0]?.signals.length === 1, 2000, "the send");
    await closeSocket(client.socket);
    await waitFor(() => plane.agents[0]!.signals[0]!.aborted, 2000, "the signal to abort");
    expect(plane.agents[0]!.cancels).toBe(1);
  });

  it("closing the socket while send is pending aborts the signal send was given", async () => {
    const sendGate = deferred<void>();
    const plane = await startSessionPlane(() => ({ frames: [assistant("x"), finished()], sendGate: sendGate.promise }));
    const client = await peer(plane);
    client.send({ type: "chat", message: "a", session: "s1" });
    await waitFor(() => plane.agents[0]?.signals.length === 1, 2000, "send to be called");
    await closeSocket(client.socket);
    await waitFor(() => plane.agents[0]!.signals[0]!.aborted, 2000, "the signal to abort");
    sendGate.resolve();
    await waitFor(() => plane.stderr.some((l) => l.includes("control session s1 turn interrupted")), 2000, "the interrupted line");
  });

  it("closing the socket while build is held sends nothing once the agent arrives", async () => {
    const gate = deferred<void>();
    const plane = await startSessionPlane(() => quick, (n) => (n === 0 ? gate.promise : undefined));
    const client = await peer(plane);
    client.send({ type: "chat", message: "a", session: "s1" });
    await waitFor(() => plane.builds() === 1, 2000, "the build to start");
    await closeSocket(client.socket);
    gate.resolve();
    await waitFor(() => plane.agents[0]?.disposed === 1, 2000, "the late agent to be disposed");
    expect(plane.agents[0]!.sent).toEqual([]);
  });

  it("closing the control plane during a session turn cancels it and disposes the agent", async () => {
    const plane = await startSessionPlane(() => ({ frames: [assistant("x")], before: new Promise<void>(() => undefined) }));
    const client = await peer(plane);
    client.send({ type: "chat", message: "a", session: "s1" });
    await waitFor(() => plane.agents[0]?.signals.length === 1, 2000, "the send");
    await plane.handle.close();
    expect(plane.agents[0]!.signals[0]!.aborted).toBe(true);
    expect(plane.agents[0]!.disposed).toBe(1);
  });

  it("an interrupted session turn writes one stderr line naming its session", async () => {
    const plane = await startSessionPlane(() => ({ frames: [assistant("x")], before: new Promise<void>(() => undefined) }));
    const client = await peer(plane);
    client.send({ type: "chat", message: "secret text", session: "owner-7" });
    await waitFor(() => plane.agents[0]?.signals.length === 1, 2000, "the send");
    client.send({ type: "interrupt", session: "owner-7" });
    await client.until(hasType("interrupted"), "interrupted");
    await waitFor(() => plane.stderr.length > 0, 2000, "a stderr line");
    expect(plane.stderr.filter((l) => l.includes("interrupted"))).toEqual(["theoclaw: control session owner-7 turn interrupted"]);
    expect(plane.stderr.join("\n")).not.toContain("secret text");
  });

  it("a chat frame whose session is null runs sessionless, as the field was ignored before", async () => {
    const plane = await startSessionPlane(() => quick);
    const client = await peer(plane);
    client.send({ type: "chat", message: "hi", session: null });
    await client.until(hasType("done"), "done");
    expect(client.frames.at(-1)).toEqual({ type: "done" });
    expect(plane.builds()).toBe(0);
  });

  it("a sessionless chat frame still runs a fresh agent beside the sessions", async () => {
    const plane = await startSessionPlane(() => quick);
    const client = await peer(plane);
    client.send({ type: "chat", message: "hi" });
    await client.until(hasType("done"), "done");
    expect(client.frames.at(-1)).toEqual({ type: "done" });
    expect(plane.builds()).toBe(0);
  });
});
