/**
 * B-376 T4.2 — the TUI: an Ink app on `@theokit/tui`, a client of the running instance. Rendered with
 * `ink-testing-library` against a real listener whose session agents are fakes, so every keypress
 * crosses the real `/control` socket.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";

import { render } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";

import { type ControlClient, createControlClient } from "../src/control-client/control-client.js";
import { composerReady } from "./composer-ready.js";
import { createContainer } from "../src/composition.js";
import { controlOptions } from "../src/control-plane/control-wiring.js";
import { type ControlPlaneHandle, healthHandler, listenControlPlane } from "../src/control-plane/listener.js";
import type { TurnAgent } from "../src/control-plane/turn.js";
import { TheoClawTui } from "../src/tui/app.js";
import { nextSessionId } from "../src/tui/frames.js";
import { assistant, deferred, FakeAgent, type FakeTurn, finished, waitFor } from "./fakes.js";

const TOKEN = "control-token-for-the-tui-tests-5c0e8a1";
const MODEL_KEY = "sk-or-model-key-for-the-tui-tests-9911";
const APP = new URL("..", import.meta.url).pathname;
const ENTER = "\r";
const ESC = "\u001B";

let handles: ControlPlaneHandle[] = [];
let clients: ControlClient[] = [];
let unmounts: (() => void)[] = [];
let children: ChildProcess[] = [];
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount();
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const handle of handles.splice(0)) await handle.close();
});

interface Instance {
  readonly port: number;
  readonly agents: FakeAgent[];
}

async function startInstance(turnFor: (n: number) => FakeTurn): Promise<Instance> {
  const agents: FakeAgent[] = [];
  const handle = await listenControlPlane({
    handler: healthHandler,
    port: 0,
    host: "127.0.0.1",
    control: controlOptions(
      TOKEN,
      createContainer<TurnAgent>({ factory: () => new FakeAgent(turnFor(0)) }).withAgent,
      async () => {
        const agent = new FakeAgent(turnFor(agents.length));
        agents.push(agent);
        return agent;
      },
      () => undefined,
    ),
    stderr: () => undefined,
  });
  handles.push(handle);
  return { port: handle.address().port, agents };
}

async function renderTui(instance: Instance, session = "owner") {
  const client = await createControlClient({ url: `ws://127.0.0.1:${instance.port}/control`, token: TOKEN });
  clients.push(client);
  const view = render(<TheoClawTui client={client} session={session} onExit={() => undefined} />);
  unmounts.push(view.unmount);
  const screen = (): string => view.lastFrame() ?? "";
  const until = (predicate: (frame: string) => boolean, what: string): Promise<void> =>
    waitFor(() => predicate(screen()), 3000, `${what}; screen:\n${screen()}`);
  // Each write is its own keypress: Ink parses a chunk at a time.
  const type = async (...keys: string[]): Promise<void> => {
    for (const key of keys) {
      view.stdin.write(key);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  await composerReady((key) => view.stdin.write(key), screen, "Message TheoClaw");
  return { view, screen, until, type };
}

const quick: FakeTurn = { frames: [assistant("ok"), finished()] };

describe("theoclaw-tui (T4.2)", () => {
  it("a multiline draft is sent as one message", async () => {
    const instance = await startInstance(() => quick);
    const tui = await renderTui(instance);
    await tui.type("line one", "\n", "line two", ENTER);
    await waitFor(() => instance.agents[0]?.sent.length === 1, 3000, "the message to reach the instance");
    expect(instance.agents[0]!.sent).toEqual(["line one\nline two"]);
  });

  it("typing a slash lists /interrupt, /new and /quit", async () => {
    const instance = await startInstance(() => quick);
    const tui = await renderTui(instance);
    await tui.type("/");
    await tui.until((f) => f.includes("interrupt") && f.includes("new") && f.includes("quit"), "the slash commands");
  });

  it("a tool event renders a tool card before the turn ends", async () => {
    // The card draws `lookup_ledger` as `LookupLedger`, which nothing the owner typed contains.
    const instance = await startInstance(() => ({ frames: [], toolHeld: true, toolName: "lookup_ledger" }));
    const tui = await renderTui(instance);
    await tui.type("go", ENTER);
    await tui.until((f) => f.includes("LookupLedger"), "the tool card");
    expect(instance.agents[0]!.signals[0]!.aborted).toBe(false);
  });

  it("Esc during a turn sends an interrupt for the session", async () => {
    const instance = await startInstance(() => ({ frames: [assistant("never")], before: new Promise<void>(() => undefined) }));
    const tui = await renderTui(instance);
    await tui.type("hi", ENTER);
    await waitFor(() => instance.agents[0]?.signals.length === 1, 3000, "the turn to start");
    await tui.type(ESC);
    await waitFor(() => instance.agents[0]!.cancels === 1, 2000, "the instance to cancel the turn");
    expect(instance.agents[0]!.signals[0]!.aborted).toBe(true);
    await tui.until((f) => f.includes("interrupted"), "the turn shown interrupted");
  });

  it("/new switches to a fresh session id", async () => {
    const instance = await startInstance(() => quick);
    const tui = await renderTui(instance);
    await tui.type("first", ENTER);
    await waitFor(() => instance.agents.length === 1 && instance.agents[0]!.sent.length === 1, 3000, "the first turn");
    await tui.until((f) => f.includes("ok"), "the first reply");
    // The first Enter accepts the highlighted completion, the second submits it.
    await tui.type("/new", ENTER, ENTER);
    await tui.until((f) => f.includes("owner-1"), "the new session id");
    await tui.type("second", ENTER);
    await waitFor(() => instance.agents.length === 2, 3000, "a second session agent");
    expect(instance.agents[1]!.sent).toEqual(["second"]);
  });

  it("/new keeps the session id within 64 characters", () => {
    const base = "x".repeat(64);
    const next = nextSessionId(base, 12);
    expect(next).toHaveLength(64);
    expect(next.endsWith("-12")).toBe(true);
    expect(nextSessionId("owner", 1)).toBe("owner-1");
  });

  it("a second Esc during an interrupt does not crash the TUI", async () => {
    const teardown = deferred<void>();
    const instance = await startInstance((n) =>
      n === 0 ? { frames: [assistant("x")], before: new Promise<void>(() => undefined), teardown: teardown.promise } : quick,
    );
    const tui = await renderTui(instance);
    await tui.type("hi", ENTER);
    await waitFor(() => instance.agents[0]?.signals.length === 1, 3000, "the turn to start");
    await tui.type(ESC, ESC);
    teardown.resolve();
    await tui.until((f) => f.includes("interrupted"), "the turn shown interrupted");
    await tui.type("again", ENTER);
    await waitFor(() => instance.agents[0]!.sent.length === 2, 3000, "the redirect to reach the instance");
  });

  it("a redirect typed right after Esc is sent once the interrupted turn ends", async () => {
    const teardown = deferred<void>();
    const instance = await startInstance((n) =>
      n === 0 ? { frames: [assistant("x")], before: new Promise<void>(() => undefined), teardown: teardown.promise } : quick,
    );
    const tui = await renderTui(instance);
    await tui.type("hi", ENTER);
    await waitFor(() => instance.agents[0]?.signals.length === 1, 3000, "the turn to start");
    // The cancelled run is still unwinding, so the TUI still holds the turn when the redirect is typed.
    await tui.type(ESC, "again", ENTER);
    await tui.until((f) => f.includes("sent when the running turn ends"), "the queued notice");
    teardown.resolve();
    await waitFor(() => instance.agents[0]!.sent.length === 2, 3000, "the redirect to reach the instance");
    expect(instance.agents[0]!.sent).toEqual(["hi", "again"]);
  });

  it("/new during a turn is refused, so Esc still stops that turn", async () => {
    const instance = await startInstance(() => ({ frames: [assistant("never")], before: new Promise<void>(() => undefined) }));
    const tui = await renderTui(instance);
    await tui.type("hi", ENTER);
    await waitFor(() => instance.agents[0]?.signals.length === 1, 3000, "the turn to start");
    await tui.type("/new", ENTER, ENTER);
    await tui.until((f) => f.includes("press Esc first"), "the refusal");
    expect(tui.screen()).toContain("session owner");
    expect(tui.screen()).not.toContain("owner-1");
    await tui.type(ESC);
    await waitFor(() => instance.agents[0]!.cancels === 1, 2000, "the instance to cancel the original turn");
  });

  it("partial assistant text is drawn before the turn ends", async () => {
    const hold = deferred<void>();
    const instance = await startInstance(() => ({ frames: [assistant("Hello"), finished()], deltas: ["Hel"], afterDeltas: hold.promise }));
    const tui = await renderTui(instance);
    await tui.type("hi", ENTER);
    await tui.until((f) => f.includes("Hel"), "the first delta");
    // Drawn while the instance still holds the rest of the turn: the cancel hint is still up.
    expect(tui.screen()).toContain("esc to interrupt");
    hold.resolve();
    await waitFor(() => !tui.screen().includes("esc to interrupt"), 3000, "the turn to end");
  });
});

/** Run the TUI entry under a pseudo-terminal (`script`), as a person would, and type into it. */
function tuiProcess(port: number): { child: ChildProcess; output: () => string; exited: Promise<number | null> } {
  const command = `${process.execPath} --import tsx src/tui/main.ts`;
  const child = spawn("script", ["-qfec", command, "/dev/null"], {
    cwd: APP,
    env: { PATH: process.env.PATH ?? "", TERM: "xterm", THEOCLAW_CONTROL_TOKEN: TOKEN, OPENROUTER_API_KEY: MODEL_KEY, THEOCLAW_PORT: String(port) },
  });
  children.push(child);
  let out = "";
  child.stdout!.on("data", (data: Buffer) => (out += data.toString()));
  child.stderr!.on("data", (data: Buffer) => (out += data.toString()));
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  return { child, output: () => out, exited };
}

describe("theoclaw-tui entry (T4.2)", { timeout: 40_000 }, () => {
  it("the TUI's stdout and stderr hold neither the token nor the model key", async () => {
    const leak = `refused ${TOKEN} with ${MODEL_KEY}`;
    const instance = await startInstance(() => ({ frames: [{ type: "status", status: "ERROR", message: leak }], result: { status: "error" } }));
    const tui = tuiProcess(instance.port);
    await waitFor(() => tui.output().includes("owner"), 20_000, `the TUI to start; output: ${tui.output()}`);
    for (const key of ["h", "i", ENTER]) {
      tui.child.stdin!.write(key);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await waitFor(() => instance.agents[0]?.sent.length === 1, 10_000, "the turn to reach the instance");
    await new Promise((resolve) => setTimeout(resolve, 500)); // the error frame is drawn; nothing is awaited on it
    for (const key of ["/", "q", "u", "i", "t", ENTER, ENTER]) {
      tui.child.stdin!.write(key);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await tui.exited).toBe(0);
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as { port: number };
        probe.close(() => resolve(free));
      });
    });
    const refused = tuiProcess(port);
    expect(await refused.exited).toBe(1);
    const all = tui.output() + refused.output();
    expect(refused.output()).toContain("cannot reach the instance");
    expect(all.split(TOKEN)).toHaveLength(1);
    expect(all.split(MODEL_KEY)).toHaveLength(1);
  });
});
