/**
 * B-376 T4.1 — the desktop sidecar speaks the template's contract (message in argv[2], one JSONL UI
 * message chunk per line on stdout, exit after one turn) and forwards the turn to the running
 * instance instead of running an agent. Spawned as the Tauri shell spawns it, against a real listener
 * whose session agents are fakes.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createContainer } from "../src/composition.js";
import { controlOptions } from "../src/control-plane/control-wiring.js";
import { type ControlPlaneHandle, healthHandler, listenControlPlane } from "../src/control-plane/listener.js";
import type { TurnAgent } from "../src/control-plane/turn.js";
import { assistant, FakeAgent, type FakeTurn, finished, waitFor } from "./fakes.js";

const TOKEN = "control-token-for-the-sidecar-tests-4b9d1";
const MODEL_KEY = "sk-or-model-key-for-the-sidecar-tests-77";
const APP = new URL("..", import.meta.url).pathname;

let handles: ControlPlaneHandle[] = [];
let children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const handle of handles.splice(0)) await handle.close();
});

async function startInstance(turn: FakeTurn): Promise<{ port: number; agents: FakeAgent[] }> {
  const agents: FakeAgent[] = [];
  const handle = await listenControlPlane({
    handler: healthHandler,
    port: 0,
    host: "127.0.0.1",
    control: controlOptions(
      TOKEN,
      createContainer<TurnAgent>({ factory: () => new FakeAgent(turn) }).withAgent,
      async () => {
        const agent = new FakeAgent(turn);
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

interface Run {
  readonly child: ChildProcess;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exited: Promise<number | null>;
}

function sidecar(message: string, env: Record<string, string>): Run {
  const child = spawn(process.execPath, ["--import", "tsx", "src/desktop/sidecar.ts", message], {
    cwd: APP,
    env: { PATH: process.env.PATH ?? "", OPENROUTER_API_KEY: MODEL_KEY, THEOCLAW_CONTROL_TOKEN: TOKEN, ...env },
  });
  children.push(child);
  let out = "";
  let err = "";
  child.stdout.on("data", (data: Buffer) => (out += data.toString()));
  child.stderr.on("data", (data: Buffer) => (err += data.toString()));
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  return { child, stdout: () => out, stderr: () => err, exited };
}

const lines = (text: string): Array<Record<string, unknown>> =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

async function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

describe("theoclaw-desktop-sidecar (T4.1)", { timeout: 30_000 }, () => {
  it("the sidecar writes the turn as UI message chunk lines and exits 0", async () => {
    const { port, agents } = await startInstance({ frames: [assistant("Hello"), finished()], deltas: ["Hel", "lo"] });
    const run = sidecar("hi there", { THEOCLAW_PORT: String(port) });
    expect(await run.exited).toBe(0);
    const chunks = lines(run.stdout());
    expect(chunks[0]).toEqual({ type: "start" });
    expect(chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("")).toBe("Hello");
    expect(chunks.at(-1)?.type).toBe("finish");
    expect(agents[0]!.sent).toEqual(["hi there"]);
  });

  it("a failed turn writes one error line and exits 1", async () => {
    const { port } = await startInstance({ frames: [assistant("x")], result: { status: "error" } });
    const run = sidecar("hi", { THEOCLAW_PORT: String(port) });
    expect(await run.exited).toBe(1);
    const errors = lines(run.stdout()).filter((c) => c.type === "error");
    expect(errors).toEqual([{ type: "error", errorText: "turn_failed" }]);
  });

  it("killing the sidecar mid-turn cancels the turn on the instance", async () => {
    const { port, agents } = await startInstance({ frames: [assistant("x")], before: new Promise<void>(() => undefined) });
    const run = sidecar("hi", { THEOCLAW_PORT: String(port) });
    await waitFor(() => agents[0]?.signals.length === 1, 10_000, "the turn to reach the instance");
    const killedAt = Date.now();
    run.child.kill("SIGKILL");
    await waitFor(() => agents[0]!.cancels === 1, 2000, "the instance to cancel the turn");
    expect(agents[0]!.signals[0]!.aborted).toBe(true);
    expect(Date.now() - killedAt).toBeLessThan(2000);
  });

  it("the sidecar refuses an empty message and an invalid THEOCLAW_SESSION with one error line", async () => {
    const { port, agents } = await startInstance({ frames: [finished()] });
    const empty = sidecar("", { THEOCLAW_PORT: String(port) });
    expect(await empty.exited).toBe(1);
    expect(lines(empty.stdout())).toEqual([{ type: "error", errorText: "empty_message" }]);
    const bad = sidecar("hi", { THEOCLAW_PORT: String(port), THEOCLAW_SESSION: "not valid!" });
    expect(await bad.exited).toBe(1);
    expect(lines(bad.stdout())).toEqual([{ type: "error", errorText: "THEOCLAW_SESSION" }]);
    expect(agents).toHaveLength(0);
  });

  it("the sidecar's stdout and stderr hold neither the token nor the model key", async () => {
    const leak = `refused ${TOKEN} with ${MODEL_KEY}`;
    const { port } = await startInstance({
      frames: [{ type: "status", status: "ERROR", message: leak }],
      result: { status: "error" },
    });
    const turn = sidecar("hi", { THEOCLAW_PORT: String(port) });
    await turn.exited;
    const refused = sidecar("hi", { THEOCLAW_PORT: String(await closedPort()) });
    expect(await refused.exited).toBe(1);
    const all = [turn, refused].map((r) => r.stdout() + r.stderr()).join("\n");
    expect(lines(refused.stdout())).toEqual([{ type: "error", errorText: "connect_failed" }]);
    expect(all.split(TOKEN)).toHaveLength(1);
    expect(all.split(MODEL_KEY)).toHaveLength(1);
  });
});
