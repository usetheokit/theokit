import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EventEmitter } from "node:events";

import { afterAll, afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { startTheoClaw } from "../src/composition.js";
import { TheoClawBindError, TheoClawConfigError } from "../src/control-plane/errors.js";
import { type ControlPlaneHandle, listenControlPlane } from "../src/control-plane/listener.js";
import { readControlPlaneSettings, resolveModelKey } from "../src/control-plane/settings.js";

// Each start makes its tool root `files/` in its working directory (B-382): a scratch one, never the checkout.
const TOOL_CWD = mkdtempSync(join(tmpdir(), "theoclaw-start-"));
afterAll(() => rmSync(TOOL_CWD, { recursive: true, force: true }));


const MODEL_KEY = "model-key-value-5d1e8c";
const TOKEN = "control-token-value-0123456789abcdef"; // 36 characters

/** A complete environment; each refusal test removes or spoils exactly one variable. */
function validEnv(): Record<string, string | undefined> {
  return {
    THEOCLAW_MODEL: "openrouter/some/model",
    OPENROUTER_API_KEY: MODEL_KEY,
    THEOCLAW_PORT: "0",
    THEOCLAW_CONTROL_TOKEN: TOKEN,
    THEOCLAW_OWNERS: "telegram:owner",
    THEOCLAW_DM_POLICY: "allowlist",
  };
}

function refusal(env: Record<string, string | undefined>): Error {
  try {
    readControlPlaneSettings(env);
  } catch (error) {
    return error as Error;
  }
  throw new Error("readControlPlaneSettings accepted an environment it must refuse");
}

/** AC-003 (B-372): every bad value is refused before anything opens, by name, never by value. */
describe("readControlPlaneSettings", () => {
  it("reads a complete environment", () => {
    expect(readControlPlaneSettings(validEnv())).toEqual({
      host: "127.0.0.1",
      port: 0,
      model: "openrouter/some/model",
      modelKey: MODEL_KEY,
      controlToken: TOKEN,
    });
  });

  it("refuses a start without THEOCLAW_MODEL and names the variable", () => {
    for (const model of [undefined, "   "]) {
      const error = refusal({ ...validEnv(), THEOCLAW_MODEL: model });
      expect(error).toBeInstanceOf(TheoClawConfigError);
      expect(error.message).toContain("THEOCLAW_MODEL");
      expect((error as TheoClawConfigError).variable).toBe("THEOCLAW_MODEL");
    }
  });

  it("refuses a start without a model key and names both variables", () => {
    const error = refusal({ ...validEnv(), OPENROUTER_API_KEY: undefined, THEOKIT_API_KEY: " " });
    expect(error).toBeInstanceOf(TheoClawConfigError);
    expect(error.message).toContain("THEOKIT_API_KEY");
    expect(error.message).toContain("OPENROUTER_API_KEY");
    expect(error.message).not.toContain("THEOCLAW_MODEL");
    expect((error as TheoClawConfigError).variable).toBe("THEOKIT_API_KEY");
  });

  it("refuses a start without THEOCLAW_PORT and names the variable", () => {
    const error = refusal({ ...validEnv(), THEOCLAW_PORT: undefined });
    expect(error).toBeInstanceOf(TheoClawConfigError);
    expect((error as TheoClawConfigError).variable).toBe("THEOCLAW_PORT");
    expect(error.message).toContain("THEOCLAW_PORT");
    // The key was read before the port failed; the refusal must still not carry it.
    expect(String(error)).not.toContain(MODEL_KEY);
  });

  it("refuses a control token shorter than 32 characters without printing it", () => {
    const shortToken = "tok-abcdefghijklmnopqrstuvwxyz1"; // 31 characters
    const error = refusal({ ...validEnv(), THEOCLAW_CONTROL_TOKEN: shortToken });
    expect(error).toBeInstanceOf(TheoClawConfigError);
    expect((error as TheoClawConfigError).variable).toBe("THEOCLAW_CONTROL_TOKEN");
    expect(error.message).not.toContain(shortToken);
    expect(String(error)).not.toContain(shortToken);
  });

  it("accepts a control token of exactly 32 characters", () => {
    const token = "x".repeat(32);
    expect(readControlPlaneSettings({ ...validEnv(), THEOCLAW_CONTROL_TOKEN: token }).controlToken).toBe(token);
  });

  it("leaves the control socket off when THEOCLAW_CONTROL_TOKEN is unset or empty", () => {
    expect(readControlPlaneSettings({ ...validEnv(), THEOCLAW_CONTROL_TOKEN: undefined }).controlToken).toBeUndefined();
    expect(readControlPlaneSettings({ ...validEnv(), THEOCLAW_CONTROL_TOKEN: "" }).controlToken).toBeUndefined();
  });

  it("refuses a public bind last, after every other value was read", () => {
    expect(refusal({ ...validEnv(), THEOCLAW_HOST: "0.0.0.0" })).toBeInstanceOf(TheoClawBindError);
    const earlier = refusal({ ...validEnv(), THEOCLAW_HOST: "0.0.0.0", THEOCLAW_MODEL: undefined });
    expect((earlier as TheoClawConfigError).variable).toBe("THEOCLAW_MODEL");
  });

  it("checks the model, the key, the port and the token in that order", () => {
    const allBad = { THEOCLAW_CONTROL_TOKEN: "short", THEOCLAW_PORT: "x" };
    expect((refusal(allBad) as TheoClawConfigError).variable).toBe("THEOCLAW_MODEL");
    expect((refusal({ ...allBad, THEOCLAW_MODEL: "m" }) as TheoClawConfigError).variable).toBe("THEOKIT_API_KEY");
    expect(
      (refusal({ ...allBad, THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: MODEL_KEY }) as TheoClawConfigError).variable,
    ).toBe("THEOCLAW_PORT");
    expect(
      (refusal({ ...allBad, THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: MODEL_KEY, THEOCLAW_PORT: "0" }) as TheoClawConfigError)
        .variable,
    ).toBe("THEOCLAW_CONTROL_TOKEN");
  });

  it("refuses a control token padded with whitespace without printing it", () => {
    for (const token of [" ".repeat(32), `${TOKEN}\n`]) {
      const error = refusal({ ...validEnv(), THEOCLAW_CONTROL_TOKEN: token });
      expect((error as TheoClawConfigError).variable).toBe("THEOCLAW_CONTROL_TOKEN");
      expect(String(error)).not.toContain(TOKEN);
    }
  });
});

describe("resolveModelKey", () => {
  it("prefers THEOKIT_API_KEY and falls back to OPENROUTER_API_KEY when it is blank", () => {
    expect(resolveModelKey({ THEOKIT_API_KEY: "a", OPENROUTER_API_KEY: "b" })).toBe("a");
    expect(resolveModelKey({ THEOKIT_API_KEY: " ", OPENROUTER_API_KEY: "b" })).toBe("b");
    expect(resolveModelKey({})).toBeUndefined();
  });
});

interface StartHarness {
  readonly signals: EventEmitter;
  readonly exits: number[];
  readonly stdout: string[];
  readonly stderr: string[];
  readonly listenCalls: number;
  readonly agentsBuilt: number;
  /** Resolves when `exit` is first called. */
  readonly exited: Promise<number>;
}

const started: ControlPlaneHandle[] = [];

afterEach(async () => {
  for (const handle of started.splice(0)) await handle.close();
});

/**
 * `startTheoClaw` with stand-ins for everything the process owns: an EventEmitter for signals, a
 * recording `exit`, recording writers, a counting `listen` and a counting agent factory. Never the
 * real `process`: its signal handlers would outlive the test inside the vitest worker.
 */
function harness(options: { wrapClose?: (close: () => Promise<void>) => Promise<void> } = {}) {
  const signals = new EventEmitter();
  const exits: number[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  let listenCalls = 0;
  let agentsBuilt = 0;
  let onExit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => (onExit = resolve));
  const state: StartHarness = {
    signals,
    exits,
    stdout,
    stderr,
    exited,
    get listenCalls() {
      return listenCalls;
    },
    get agentsBuilt() {
      return agentsBuilt;
    },
  };
  const start = (env: Record<string, string | undefined>) =>
    startTheoClaw({ cwd: TOOL_CWD,
      env,
      agentFactory: () => {
        agentsBuilt += 1;
        return { send: () => Promise.reject(new Error("no turn in these tests")) };
      },
      stdout: (line) => void stdout.push(line),
      stderr: (line) => void stderr.push(line),
      // No stream to mask: the real process streams would keep one mask per start in this worker.
      streams: [],
      signals,
      exit: (code) => {
        exits.push(code);
        onExit(code);
      },
      listen: async (listenOptions) => {
        listenCalls += 1;
        const handle = await listenControlPlane(listenOptions);
        started.push(handle);
        const wrap = options.wrapClose;
        return wrap === undefined ? handle : { ...handle, close: () => wrap(handle.close) };
      },
    });
  return { state, start };
}

/** AC-003 (B-372): the start refuses before anything opens, and closes cleanly on a signal. */
describe("startTheoClaw", () => {
  it("refuses a non-loopback bind before any socket opens or agent is built", async () => {
    const { state, start } = harness();

    await expect(start({ ...validEnv(), THEOCLAW_HOST: "0.0.0.0" })).rejects.toThrow(TheoClawBindError);

    expect(state.listenCalls).toBe(0);
    expect(state.agentsBuilt).toBe(0);
  });

  it("refuses a start without THEOCLAW_OWNERS before the shutdown or the output mask is installed", async () => {
    const { state, start } = harness();
    const { THEOCLAW_OWNERS: _omitted, ...env } = validEnv();

    const error = await start(env).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TheoClawConfigError);
    expect((error as TheoClawConfigError).variable).toBe("THEOCLAW_OWNERS");
    expect(state.signals.eventNames()).toEqual([]);
    expect(state.listenCalls).toBe(0);
  });

  it("refuses a start without a model or a key before any socket opens", async () => {
    const { state, start } = harness();

    await expect(start({ ...validEnv(), THEOCLAW_MODEL: undefined })).rejects.toThrow("THEOCLAW_MODEL");
    await expect(start({ ...validEnv(), OPENROUTER_API_KEY: undefined })).rejects.toThrow("OPENROUTER_API_KEY");

    expect(state.listenCalls).toBe(0);
    expect(state.agentsBuilt).toBe(0);
  });

  it("writes the address read from the socket to stdout", async () => {
    const { state, start } = harness();

    const handle = await start(validEnv());

    const { port } = handle.address();
    expect(port).toBeGreaterThan(0);
    expect(state.stdout).toContain(`theoclaw: control plane listening on 127.0.0.1:${port}`);
    expect(state.agentsBuilt).toBe(0);
  });

  it("brackets an IPv6 address in the listening line", async () => {
    const { state, start } = harness();

    const handle = await start({ ...validEnv(), THEOCLAW_HOST: "::1" });

    expect(state.stdout).toContain(`theoclaw: control plane listening on [::1]:${handle.address().port}`);
  });

  it("says the control socket is off when THEOCLAW_CONTROL_TOKEN is unset", async () => {
    const { state, start } = harness();

    await start({ ...validEnv(), THEOCLAW_CONTROL_TOKEN: undefined });

    expect(state.stdout).toContain("theoclaw: control socket off (THEOCLAW_CONTROL_TOKEN unset)");
  });

  it("closes the listener and exits 0 on SIGINT", async () => {
    const { state, start } = harness();
    const handle = await start(validEnv());

    state.signals.emit("SIGINT");

    expect(await state.exited).toBe(0);
    expect(handle.server.listening).toBe(false);
  });

  it("ignores a second SIGINT while closing", async () => {
    let release = (): void => undefined;
    const holdClose = new Promise<void>((resolve) => (release = resolve));
    const { state, start } = harness({ wrapClose: async (close) => (await holdClose, close()) });
    await start(validEnv());

    state.signals.emit("SIGINT");
    state.signals.emit("SIGINT");
    release();
    await state.exited;

    expect(state.exits).toEqual([0]);
    expect(state.stderr).toContain("theoclaw: SIGINT ignored, already stopping");
  });

  it("exits 1 and writes why when the close fails", async () => {
    const { state, start } = harness({
      wrapClose: async (close) => {
        await close();
        throw new Error("close broke");
      },
    });
    await start(validEnv());

    state.signals.emit("SIGTERM");

    expect(await state.exited).toBe(1);
    expect(state.stderr.join("\n")).toContain("theoclaw: closing the control plane failed: close broke");
  });

  it("closes the listener and exits 0 on SIGINT with a control socket open", async () => {
    const { state, start } = harness();
    const handle = await start(validEnv());
    const { host, port } = handle.address();
    const client = new WebSocket(`ws://${host}:${port}/control`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    client.on("error", () => undefined);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("unexpected-response", () => reject(new Error("the upgrade was refused")));
    });
    const clientClosed = new Promise<void>((resolve) => client.once("close", () => resolve()));

    state.signals.emit("SIGINT");

    let timer: NodeJS.Timeout | undefined;
    const code = await Promise.race([
      state.exited,
      new Promise<string>((resolve) => (timer = setTimeout(() => resolve("no exit within 2 s"), 2_000))),
    ]);
    clearTimeout(timer);
    expect(code).toBe(0);
    await clientClosed;
    expect(handle.server.listening).toBe(false);
  });
});
