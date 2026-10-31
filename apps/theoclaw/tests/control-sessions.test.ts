import { describe, expect, it } from "vitest";

import { assistant, deferred, FakeAgent, finished } from "./fakes.js";

/** Drain an async iterable into an array. */
async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("the fake run honours the turn signal (T2.1)", () => {
  it("an aborted signal ends a held fake stream within 2000 ms and wait resolves cancelled", async () => {
    const held = deferred<void>();
    const agent = new FakeAgent({ frames: [assistant("never")], before: held.promise });
    const controller = new AbortController();
    const run = await agent.send("hi", { signal: controller.signal });
    const started = Date.now();
    const frames = drain(run.stream());
    controller.abort();
    expect(await frames).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await run.wait()).toEqual({ status: "cancelled" });
    expect(agent.signals[0]).toBe(controller.signal);
  });

  it("events yields the text deltas, then the messages marked textAlreadyStreamed", async () => {
    const agent = new FakeAgent({ frames: [assistant("Hello"), finished()], deltas: ["Hel", "lo"] });
    const run = await agent.send("hi", { signal: new AbortController().signal });
    const events = await drain(run.events());
    expect(events.map((e) => e.kind)).toEqual(["delta", "delta", "message", "message"]);
    expect(events[2]).toMatchObject({ kind: "message", textAlreadyStreamed: true });
  });
});

// ---------------------------------------------------------------------------------------------
// T2.2 — the control session store
// ---------------------------------------------------------------------------------------------

import { afterEach, vi } from "vitest";

import { createContainer } from "../src/composition.js";
import {
  CANCEL_DRAIN_MS,
  type ControlSessions,
  createControlSessions,
  MAX_CONTROL_SESSIONS,
  type SessionOutcome,
} from "../src/control-plane/control-sessions.js";
import { createTurnRunner, type TurnAgent, type TurnEvent } from "../src/control-plane/turn.js";
import { type Deferred, type FakeTurn, waitFor } from "./fakes.js";

/** A fake agent that counts its disposals, as the session store disposes through `Symbol.asyncDispose`. */
class DisposableFake extends FakeAgent {
  disposed = 0;
  async [Symbol.asyncDispose](): Promise<void> {
    this.disposed += 1;
  }
}

interface StoreFixture {
  readonly sessions: ControlSessions;
  readonly agents: DisposableFake[];
  readonly reports: string[];
  /** Builds started, held or not. */
  builds: number;
}

let openStores: ControlSessions[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const store of openStores) await store.close().catch(() => undefined);
  openStores = [];
});

/** A store over fake agents; `turnFor(n)` scripts the nth built agent, `buildGate(n)` holds its build. */
function storeOf(
  turnFor: (n: number) => FakeTurn,
  options: { readonly buildGate?: (n: number) => Promise<void> | undefined; readonly maxSessions?: number; readonly buildError?: (n: number) => Error | undefined } = {},
): StoreFixture {
  const fixture: { -readonly [K in keyof StoreFixture]: StoreFixture[K] } = {
    sessions: undefined as unknown as ControlSessions,
    agents: [],
    reports: [],
    builds: 0,
  };
  fixture.sessions = createControlSessions({
    build: async () => {
      const n = fixture.builds;
      fixture.builds += 1;
      const gate = options.buildGate?.(n);
      if (gate !== undefined) await gate;
      const error = options.buildError?.(n);
      if (error !== undefined) throw error;
      const agent = new DisposableFake(turnFor(n));
      fixture.agents.push(agent);
      return agent;
    },
    report: (line) => void fixture.reports.push(line),
    ...(options.maxSessions === undefined ? {} : { maxSessions: options.maxSessions }),
  });
  openStores.push(fixture.sessions);
  return fixture as StoreFixture;
}

const quick: FakeTurn = { frames: [assistant("ok"), finished()] };
const owner = (): object => ({});
const collect = (): { events: TurnEvent[]; emit: (e: TurnEvent) => void } => {
  const events: TurnEvent[] = [];
  return { events, emit: (e) => void events.push(e) };
};
const live = (agents: DisposableFake[]): number => agents.filter((a) => a.disposed === 0).length;

describe("the control session store (T2.2)", () => {
  it("two turns on one session run on one agent", async () => {
    const f = storeOf(() => quick);
    const me = owner();
    expect(await f.sessions.run("s1", "first", collect().emit, me)).toEqual({ ok: true });
    expect(await f.sessions.run("s1", "second", collect().emit, me)).toEqual({ ok: true });
    expect(f.builds).toBe(1);
    expect(f.agents[0]!.sent).toEqual(["first", "second"]);
  });

  it("a sessionless turn builds and disposes its own agent", async () => {
    const built: DisposableFake[] = [];
    const agents = createContainer<TurnAgent>({
      factory: () => {
        const agent = new DisposableFake(quick);
        built.push(agent);
        return agent;
      },
    });
    const outcome = await createTurnRunner(agents.withAgent)("hi", () => undefined);
    expect(outcome).toEqual({ ok: true });
    expect(built).toHaveLength(1);
    expect(built[0]!.disposed).toBe(1);
  });

  it("a session turn forwards text deltas before the run ends", async () => {
    const hold = deferred<void>();
    const f = storeOf(() => ({ frames: [assistant("Hello"), finished()], deltas: ["Hel"], afterDeltas: hold.promise }));
    const { events, emit } = collect();
    const turn = f.sessions.run("s1", "hi", emit, owner());
    await waitFor(() => events.some((e) => e.type === "text_delta"), 2000, "the first text delta");
    expect(events).toContainEqual({ type: "text_delta", content: "Hel" });
    hold.resolve();
    expect(await turn).toEqual({ ok: true });
    // The completed message is marked textAlreadyStreamed, so its text is not sent twice.
    expect(events.filter((e) => e.type === "text_delta")).toHaveLength(1);
  });

  it("an interrupt aborts the signal the agent was sent and ends the turn with interrupted within 2000 ms", async () => {
    const hold = deferred<void>();
    const f = storeOf(() => ({ frames: [assistant("never")], before: hold.promise }));
    const turn = f.sessions.run("s1", "hi", collect().emit, owner());
    await waitFor(() => f.agents[0]?.signals.length === 1, 2000, "the send");
    const started = Date.now();
    expect(f.sessions.interrupt("s1")).toBe("cancelled");
    expect(await turn).toEqual({ ok: false, code: "interrupted" });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(f.agents[0]!.signals[0]!.aborted).toBe(true);
    expect(f.agents[0]!.cancels).toBe(1);
  });

  it("the turn after an interrupt runs on the same session agent", async () => {
    const hold = deferred<void>();
    const f = storeOf(() => ({ frames: [assistant("ok"), finished()], before: hold.promise }));
    const me = owner();
    const turn = f.sessions.run("s1", "first", collect().emit, me);
    await waitFor(() => f.agents[0]?.signals.length === 1, 2000, "the send");
    f.sessions.interrupt("s1");
    await turn;
    hold.resolve();
    expect(await f.sessions.run("s1", "redirect", collect().emit, me)).toEqual({ ok: true });
    expect(f.builds).toBe(1);
    expect(f.agents[0]!.sent).toEqual(["first", "redirect"]);
  });

  it("an interrupt while a tool call is held aborts its signal and ends the turn interrupted", async () => {
    const f = storeOf((n) => (n === 0 ? { frames: [], toolHeld: true } : quick));
    const { events, emit } = collect();
    const turn = f.sessions.run("s1", "use a tool", emit, owner());
    await waitFor(() => events.some((e) => e.type === "tool_call"), 2000, "the tool call");
    f.sessions.interrupt("s1");
    expect(await turn).toEqual({ ok: false, code: "interrupted" });
    expect(f.agents[0]!.signals[0]!.aborted).toBe(true);
    // The session stays usable: the next turn runs on the same agent.
    expect(f.builds).toBe(1);
  });

  it("a chat frame on a busy session from another socket gets busy", async () => {
    const hold = deferred<void>();
    const f = storeOf(() => ({ frames: [assistant("ok"), finished()], before: hold.promise }));
    const [first, second] = [
      f.sessions.run("s1", "a", collect().emit, owner()),
      f.sessions.run("s1", "b", collect().emit, owner()),
    ];
    expect(await second).toEqual({ ok: false, code: "busy" });
    hold.resolve();
    expect(await first).toEqual({ ok: true });
    expect(f.builds).toBe(1);
  });

  it("an invalid session id gets bad_frame and builds no agent", async () => {
    const f = storeOf(() => quick);
    for (const bad of ["", "has space", "x".repeat(65), "dot.ted", "slash/x"]) {
      expect(await f.sessions.run(bad, "hi", collect().emit, owner())).toEqual({ ok: false, code: "bad_frame" });
    }
    expect(f.builds).toBe(0);
  });

  it("an interrupt with no running turn gets no_turn", async () => {
    const f = storeOf(() => quick);
    expect(f.sessions.interrupt("s1")).toBe("no_turn");
    await f.sessions.run("s1", "hi", collect().emit, owner());
    expect(f.sessions.interrupt("s1")).toBe("no_turn");
  });

  it("a 17th session disposes the least recently used idle agent", async () => {
    const f = storeOf(() => quick);
    for (let n = 0; n < MAX_CONTROL_SESSIONS; n += 1) await f.sessions.run(`s${n}`, "hi", collect().emit, owner());
    await f.sessions.run("s0", "touch", collect().emit, owner()); // s1 is now the least recently used
    await f.sessions.run("s16", "hi", collect().emit, owner());
    expect(f.agents[1]!.disposed).toBe(1);
    expect(f.agents[0]!.disposed).toBe(0);
    expect(live(f.agents)).toBe(MAX_CONTROL_SESSIONS);
  });

  it("all 16 sessions running makes a 17th busy", async () => {
    const hold = deferred<void>();
    const f = storeOf(() => ({ frames: [assistant("ok"), finished()], before: hold.promise }));
    const turns = Array.from({ length: MAX_CONTROL_SESSIONS }, (_, n) => f.sessions.run(`s${n}`, "hi", collect().emit, owner()));
    expect(await f.sessions.run("s16", "hi", collect().emit, owner())).toEqual({ ok: false, code: "busy" });
    hold.resolve();
    await Promise.all(turns);
    expect(f.builds).toBe(MAX_CONTROL_SESSIONS);
  });

  it("closing the control plane disposes every session agent", async () => {
    const f = storeOf(() => quick);
    for (const s of ["a", "b", "c"]) await f.sessions.run(s, "hi", collect().emit, owner());
    await f.sessions.close();
    expect(f.agents.map((a) => a.disposed)).toEqual([1, 1, 1]);
    expect(await f.sessions.run("d", "hi", collect().emit, owner())).toMatchObject({ ok: false, code: "turn_failed" });
    expect(f.builds).toBe(3);
  });

  it("an interrupt while send is pending aborts the signal send was given", async () => {
    const sendGate = deferred<void>();
    const f = storeOf(() => ({ frames: [assistant("late"), finished()], sendGate: sendGate.promise }));
    const { events, emit } = collect();
    const turn = f.sessions.run("s1", "hi", emit, owner());
    await waitFor(() => f.agents[0]?.signals.length === 1, 2000, "send to be called");
    expect(f.sessions.interrupt("s1")).toBe("cancelled");
    sendGate.resolve();
    expect(await turn).toEqual({ ok: false, code: "interrupted" });
    expect(f.agents[0]!.signals[0]!.aborted).toBe(true);
    expect(events.filter((e) => e.type === "text_delta")).toEqual([]);
  });

  it("an interrupt after the events ended leaves the turn done", async () => {
    const teardown = deferred<void>();
    // wait() of a run that was not aborted resolves at once, so hold the outcome on a slow wait.
    const f = storeOf(() => ({ frames: [assistant("ok"), finished()] }));
    const me = owner();
    const { events, emit } = collect();
    let sawDone = false;
    const turn = f.sessions.run("s1", "hi", (e) => {
      emit(e);
      if (e.type === "done") sawDone = true;
    }, me);
    await turn;
    teardown.resolve();
    expect(sawDone || events.length > 0).toBe(true);
    expect(f.sessions.interrupt("s1")).toBe("no_turn");
    expect(await f.sessions.run("s1", "again", collect().emit, me)).toEqual({ ok: true });
  });

  it("a failed session build records no session and the next turn builds again", async () => {
    const f = storeOf(() => quick, { buildError: (n) => (n === 0 ? new Error("no model configured") : undefined) });
    expect(await f.sessions.run("s1", "hi", collect().emit, owner())).toEqual({
      ok: false,
      code: "turn_failed",
      reason: "no model configured",
    });
    expect(await f.sessions.run("s1", "hi", collect().emit, owner())).toEqual({ ok: true });
    expect(f.builds).toBe(2);
  });

  it("an interrupt while build is held disposes the agent when it arrives and sends nothing", async () => {
    const gate = deferred<void>();
    const f = storeOf(() => quick, { buildGate: (n) => (n === 0 ? gate.promise : undefined) });
    const turn = f.sessions.run("s1", "hi", collect().emit, owner());
    await waitFor(() => f.builds === 1, 2000, "the build to start");
    expect(f.sessions.interrupt("s1")).toBe("cancelled");
    gate.resolve();
    expect(await turn).toEqual({ ok: false, code: "interrupted" });
    expect(f.agents[0]!.sent).toEqual([]);
    expect(f.agents[0]!.disposed).toBe(1);
    // The entry was removed, so the next turn on that session builds again.
    expect(await f.sessions.run("s1", "again", collect().emit, owner())).toEqual({ ok: true });
    expect(f.builds).toBe(2);
  });

  it("a turn sent while the cancelled turn is still unwinding runs once it has unwound", async () => {
    const hold = deferred<void>();
    const teardown = deferred<void>();
    const f = storeOf(() => ({ frames: [assistant("ok"), finished()], before: hold.promise, teardown: teardown.promise }));
    const me = owner();
    const first = f.sessions.run("s1", "first", collect().emit, me);
    await waitFor(() => f.agents[0]?.signals.length === 1, 2000, "the send");
    f.sessions.interrupt("s1");
    const redirect = f.sessions.run("s1", "redirect", collect().emit, me);
    teardown.resolve();
    hold.resolve();
    expect(await first).toEqual({ ok: false, code: "interrupted" });
    expect(await redirect).toEqual({ ok: true });
    expect(f.agents[0]!.sent).toEqual(["first", "redirect"]);
  });

  it("a turn sent while a cancelled turn never unwinds gets busy after 5000 ms", async () => {
    vi.useFakeTimers();
    const f = storeOf(() => ({ frames: [assistant("ok")], before: new Promise<void>(() => undefined), teardown: new Promise<void>(() => undefined) }));
    void f.sessions.run("s1", "first", collect().emit, owner());
    await vi.waitFor(() => expect(f.agents[0]?.signals.length).toBe(1));
    f.sessions.interrupt("s1");
    let outcome: SessionOutcome | undefined;
    void f.sessions.run("s1", "redirect", collect().emit, owner()).then((o) => (outcome = o));
    await vi.advanceTimersByTimeAsync(CANCEL_DRAIN_MS - 1);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ ok: false, code: "busy" });
    expect(CANCEL_DRAIN_MS).toBe(5000);
  });

  it("closing the control plane while a build is held disposes the late agent", async () => {
    const gate = deferred<void>();
    const f = storeOf(() => quick, { buildGate: () => gate.promise });
    const turn = f.sessions.run("s1", "hi", collect().emit, owner());
    await waitFor(() => f.builds === 1, 2000, "the build to start");
    const closing = f.sessions.close();
    gate.resolve();
    await closing;
    expect(await turn).toEqual({ ok: false, code: "interrupted" });
    expect(f.agents[0]!.disposed).toBe(1);
    expect(f.agents[0]!.sent).toEqual([]);
  });

  it("two new sessions admitted at once with 15 present keep the store at 16", async () => {
    const gates: Deferred<void>[] = [];
    const f = storeOf(() => quick, {
      buildGate: (n) => {
        if (n < MAX_CONTROL_SESSIONS - 1) return undefined;
        const gate = deferred<void>();
        gates.push(gate);
        return gate.promise;
      },
    });
    for (let n = 0; n < MAX_CONTROL_SESSIONS - 1; n += 1) await f.sessions.run(`s${n}`, "hi", collect().emit, owner());
    const a = f.sessions.run("new-a", "hi", collect().emit, owner());
    const b = f.sessions.run("new-b", "hi", collect().emit, owner());
    await waitFor(() => gates.length === 2, 2000, "both builds to start");
    for (const gate of gates) gate.resolve();
    expect(await a).toEqual({ ok: true });
    expect(await b).toEqual({ ok: true });
    expect(f.builds).toBe(MAX_CONTROL_SESSIONS + 1);
    expect(live(f.agents)).toBe(MAX_CONTROL_SESSIONS);
  });

  it("concurrent admissions of new sessions with every build held never exceed 16 reservations", async () => {
    const f = storeOf(() => quick, { buildGate: () => new Promise<void>(() => undefined) });
    const outcomes = Array.from({ length: MAX_CONTROL_SESSIONS + 4 }, (_, n) => f.sessions.run(`n${n}`, "hi", collect().emit, owner()));
    const settled = await Promise.race([Promise.all(outcomes.slice(MAX_CONTROL_SESSIONS)), new Promise((r) => setTimeout(r, 1000, "timeout"))]);
    expect(settled).toEqual(Array.from({ length: 4 }, () => ({ ok: false, code: "busy" })));
    expect(f.builds).toBe(MAX_CONTROL_SESSIONS);
  });

  it("a run that ends in error is turn_failed and the session stays usable", async () => {
    const f = storeOf((n) => (n === 0 ? { frames: [assistant("x")], result: { status: "error" } } : quick));
    const me = owner();
    expect(await f.sessions.run("s1", "hi", collect().emit, me)).toMatchObject({ ok: false, code: "turn_failed" });
    expect(await f.sessions.run("s1", "again", collect().emit, me)).toMatchObject({ ok: false, code: "turn_failed" });
    expect(f.builds).toBe(1);
  });

  it("cancelOwnedBy interrupts only the turns of that owner", async () => {
    const hold = deferred<void>();
    const f = storeOf(() => ({ frames: [assistant("ok"), finished()], before: hold.promise }));
    const [mine, theirs] = [owner(), owner()];
    const a = f.sessions.run("a", "hi", collect().emit, mine);
    const b = f.sessions.run("b", "hi", collect().emit, theirs);
    await waitFor(() => f.agents.length === 2 && f.agents.every((x) => x.signals.length === 1), 2000, "both sends");
    f.sessions.cancelOwnedBy(mine);
    expect(await a).toEqual({ ok: false, code: "interrupted" });
    hold.resolve();
    expect(await b).toEqual({ ok: true });
  });

  it("a session agent whose run has no events() still answers from stream()", async () => {
    const sessions = createControlSessions({
      build: async () => ({
        send: async () => ({
          async *stream() {
            yield { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "plain" }] } };
          },
          wait: async () => ({ status: "finished" }),
        }),
      }),
      report: () => undefined,
    });
    openStores.push(sessions);
    const { events, emit } = collect();
    expect(await sessions.run("s1", "hi", emit, owner())).toEqual({ ok: true });
    expect(events).toContainEqual(expect.objectContaining({ type: "text_delta", content: "plain" }));
  });
});

// ---------------------------------------------------------------------------------------------
// T2.3 — the socket speaks sessions and interrupt
// ---------------------------------------------------------------------------------------------

import WebSocket from "ws";

import { controlOptions } from "../src/control-plane/control-wiring.js";
import { type ControlPlaneHandle, healthHandler, listenControlPlane } from "../src/control-plane/listener.js";

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

  it("a sessionless chat frame still runs a fresh agent beside the sessions", async () => {
    const plane = await startSessionPlane(() => quick);
    const client = await peer(plane);
    client.send({ type: "chat", message: "hi" });
    await client.until(hasType("done"), "done");
    expect(client.frames.at(-1)).toEqual({ type: "done" });
    expect(plane.builds()).toBe(0);
  });
});
