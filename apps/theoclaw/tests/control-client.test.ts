/**
 * B-376 T3.1 — the one client both surfaces use: it connects to the running instance's `/control`
 * socket with the owner token, runs a session turn as an async iterable of frames, and builds no
 * agent (plan D1). Driven against a real listener whose session agents are fakes.
 */
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { type ControlClient, createControlClient, TheoClawControlError } from "../src/control-client/control-client.js";
import { runWithOutputMask } from "../src/control-client/masked-entry.js";
import { readControlClientSettings } from "../src/control-client/settings.js";
import { createContainer } from "../src/composition.js";
import { controlOptions } from "../src/control-plane/control-wiring.js";
import { TheoClawConfigError } from "../src/control-plane/errors.js";
import { type ControlPlaneHandle, healthHandler, listenControlPlane } from "../src/control-plane/listener.js";
import type { TurnAgent } from "../src/control-plane/turn.js";
import { assistant, deferred, FakeAgent, type FakeTurn, finished, waitFor } from "./fakes.js";

const TOKEN = "control-token-for-the-client-tests-31a7c";
const run = promisify(execFile);

let handles: ControlPlaneHandle[] = [];
let clients: ControlClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const handle of handles.splice(0)) await handle.close();
});

async function startInstance(turn: FakeTurn): Promise<{ url: string; agents: FakeAgent[] }> {
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
  const { host, port } = handle.address();
  return { url: `ws://${host}:${port}/control`, agents };
}

async function connected(url: string, token = TOKEN): Promise<ControlClient> {
  const client = await createControlClient({ url, token });
  clients.push(client);
  return client;
}

async function frames(iterable: AsyncIterable<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for await (const frame of iterable) out.push(frame as Record<string, unknown>);
  return out;
}

describe("createControlClient (T3.1)", () => {
  it("chat yields the frames of one turn and ends after the final frame", async () => {
    const { url } = await startInstance({ frames: [assistant("hello"), finished()], deltas: ["hel", "lo"] });
    const client = await connected(url);
    const turn = await frames(client.chat("hi", "owner"));
    expect(turn.at(-1)).toEqual({ type: "done", session: "owner" });
    expect(turn.filter((f) => f.type === "event").map((f) => (f.event as { type: string }).type)).toContain("text_delta");
    // The same connection runs the next turn on the same session.
    expect((await frames(client.chat("again", "owner"))).at(-1)).toEqual({ type: "done", session: "owner" });
  });

  it("interrupt sends the interrupt frame for the session", async () => {
    const hold = deferred<void>();
    const { url, agents } = await startInstance({ frames: [assistant("never")], before: hold.promise });
    const client = await connected(url);
    const turn = frames(client.chat("hi", "owner"));
    await waitFor(() => agents[0]?.signals.length === 1, 2000, "the turn to start");
    client.interrupt("owner");
    expect((await turn).at(-1)).toEqual({ type: "interrupted", session: "owner" });
    expect(agents[0]!.signals[0]!.aborted).toBe(true);
  });

  it("a wrong token rejects with the 401 and prints no token", async () => {
    const { url } = await startInstance({ frames: [finished()] });
    const wrong = "w".repeat(40);
    const error = await createControlClient({ url, token: wrong }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TheoClawControlError);
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toContain(wrong);
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("connecting to an instance that is not running rejects naming the address", async () => {
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as { port: number };
        probe.close(() => resolve(free));
      });
    });
    const error = await createControlClient({ url: `ws://127.0.0.1:${port}/control`, token: TOKEN }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TheoClawControlError);
    expect((error as Error).message).toContain(`127.0.0.1:${port}`);
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("a chat frame over the frame limit rejects with a typed error", async () => {
    const { url } = await startInstance({ frames: [finished()] });
    const client = await connected(url);
    const error = await frames(client.chat("x".repeat(70_000), "owner")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TheoClawControlError);
    expect((error as Error).message).toContain("65,536-byte");
  });

  it("a socket that closes mid-turn throws connection closed before the turn ended", async () => {
    const { url, agents } = await startInstance({ frames: [assistant("x")], before: new Promise<void>(() => undefined) });
    const client = await connected(url);
    const turn = frames(client.chat("hi", "owner"));
    await waitFor(() => agents[0]?.signals.length === 1, 2000, "the turn to start");
    await handles[0]!.close();
    handles = [];
    const error = await turn.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TheoClawControlError);
    expect((error as Error).message).toBe("connection closed before the turn ended");
  });
});

describe("readControlClientSettings (T3.1)", () => {
  const base = { THEOCLAW_CONTROL_TOKEN: TOKEN, THEOCLAW_PORT: "8123" };

  it("refuses a token shorter than 32 characters and names the variable", () => {
    const read = () => readControlClientSettings({ ...base, THEOCLAW_CONTROL_TOKEN: "short" });
    expect(read).toThrow(TheoClawConfigError);
    expect(read).toThrow(/THEOCLAW_CONTROL_TOKEN/);
    try {
      read();
    } catch (error) {
      expect((error as TheoClawConfigError).variable).toBe("THEOCLAW_CONTROL_TOKEN");
      expect((error as Error).message).not.toContain("short");
    }
  });

  it("defaults THEOCLAW_SESSION to owner and THEOCLAW_CONNECT_HOST to 127.0.0.1", () => {
    expect(readControlClientSettings(base)).toEqual({ url: "ws://127.0.0.1:8123/control", token: TOKEN, session: "owner" });
  });

  it("reads the host, port and session it is given", () => {
    const settings = readControlClientSettings({ ...base, THEOCLAW_CONNECT_HOST: "::1", THEOCLAW_SESSION: "desk-2" });
    expect(settings).toEqual({ url: "ws://[::1]:8123/control", token: TOKEN, session: "desk-2" });
  });

  it("refuses an invalid THEOCLAW_SESSION and a missing port, naming each variable", () => {
    expect(() => readControlClientSettings({ ...base, THEOCLAW_SESSION: "has space" })).toThrow(/THEOCLAW_SESSION/);
    expect(() => readControlClientSettings({ THEOCLAW_CONTROL_TOKEN: TOKEN })).toThrow(/THEOCLAW_PORT/);
    expect(() => readControlClientSettings({ ...base, THEOCLAW_PORT: "0" })).toThrow(/THEOCLAW_PORT/);
  });
});

describe("runWithOutputMask (T3.1)", () => {
  it("runWithOutputMask masks the token and the model key on stdout and stderr, including a console.error line", async () => {
    const key = "sk-or-model-key-for-the-mask-test-55";
    const script = `
      const { runWithOutputMask } = await import('./src/control-client/masked-entry.ts')
      await runWithOutputMask([${JSON.stringify(TOKEN)}, ${JSON.stringify(key)}], async () => {
        process.stdout.write('token=${TOKEN} key=${key}\\n')
        process.stderr.write('stderr ${TOKEN}\\n')
        console.error(new Error('failed with ${key}'))
      })
    `;
    const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: new URL("..", import.meta.url).pathname,
    });
    const all = stdout + stderr;
    expect(all).toContain("token=");
    expect(all).toContain("failed with");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(key);
  });

  it("restores the streams once main settles, even when it throws", async () => {
    const writes: string[] = [];
    const stream = { write: ((chunk: string) => (writes.push(String(chunk)), true)) as NodeJS.WriteStream["write"] };
    const original = stream.write;
    await expect(
      runWithOutputMask(["secret-value-x"], async () => {
        stream.write("a secret-value-x b");
        throw new Error("main failed");
      }, [stream as unknown as NodeJS.WriteStream]),
    ).rejects.toThrow("main failed");
    expect(stream.write).toBe(original);
    expect(writes.join("")).not.toContain("secret-value-x");
  });
});
