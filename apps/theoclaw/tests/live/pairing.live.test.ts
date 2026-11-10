import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { runControlTurn } from "./support/control-turn.js";
import { throwUnlessFinished } from "./support/turn-failed.js";

/**
 * AC-003 (B-709): OC-91 against a real model, through the BUILT entry (`dist/main.js`). A device
 * redeems the owner's setup code, stays refused until the owner approves it, and then runs a turn
 * on the real model with the token it chose itself. It runs only with THEOCLAW_LIVE=1 and the
 * model settings in the environment; without the flag it skips, so CI stays offline. Build first:
 * `pnpm --filter theoclaw run build`.
 */
const LIVE = process.env.THEOCLAW_LIVE === "1";
const APP_DIR = fileURLToPath(new URL("../..", import.meta.url));
const OWNER_TOKEN = `live-owner-token-${randomBytes(16).toString("hex")}`;
const DEVICE_TOKEN = `live-device-token-${randomBytes(16).toString("hex")}`;

let child: ChildProcess | undefined;
let output = "";
let port = 0;
let home = "";
let stateDir = "";

async function waitFor(pattern: RegExp, what: string): Promise<RegExpMatchArray> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const match = output.match(pattern);
    if (match !== null) return match;
    if (child === undefined || child.exitCode !== null) throw new Error(`the entry exited before ${what}: ${output}`);
    if (Date.now() > deadline) throw new Error(`no ${what} within 15 s: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The status of a `/control` upgrade with `token`: 101 when it opened. */
function upgradeStatus(token: string): Promise<number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/control`, { headers: { Authorization: `Bearer ${token}` } });
    socket.once("open", () => {
      socket.close();
      resolve(101);
    });
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.on("error", () => undefined);
  });
}

function ask(socket: WebSocket, frame: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    socket.once("message", (raw) => resolve(JSON.parse(String(raw)) as Record<string, unknown>));
    socket.send(JSON.stringify(frame));
  });
}

describe.skipIf(!LIVE)("device pairing against a real model", () => {
  beforeAll(async () => {
    const modelKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY;
    if (!process.env.THEOCLAW_MODEL || !modelKey) {
      throw new Error("THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY");
    }
    const entry = join(APP_DIR, "dist", "main.js");
    if (!existsSync(entry)) throw new Error(`${entry} is missing: run pnpm --filter theoclaw run build`);
    home = mkdtempSync(join(tmpdir(), "theoclaw-pair-live-"));
    stateDir = join(home, "state");
    mkdirSync(stateDir, { recursive: true });
    child = spawn(process.execPath, [entry], {
      cwd: home,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        THEOCLAW_MODEL: process.env.THEOCLAW_MODEL,
        ...(process.env.THEOKIT_API_KEY ? { THEOKIT_API_KEY: process.env.THEOKIT_API_KEY } : {}),
        ...(process.env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } : {}),
        THEOCLAW_PORT: "0",
        THEOCLAW_CONTROL_TOKEN: OWNER_TOKEN,
        THEOCLAW_OWNERS: "telegram:owner",
        THEOCLAW_DM_POLICY: "allowlist",
        THEOCLAW_STATE_DIR: stateDir,
        THEOCLAW_WORKSPACE: home,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const [, bound] = await waitFor(/theoclaw: control plane listening on 127\.0\.0\.1:(\d+)/, "the listening line");
    port = Number(bound);
  }, 30_000);

  afterAll(async () => {
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      const gone = new Promise((resolve) => child!.once("exit", resolve));
      child.kill("SIGINT");
      const timer = setTimeout(() => child!.kill("SIGKILL"), 5_000);
      await gone;
      clearTimeout(timer);
    }
    if (home !== "") rmSync(home, { recursive: true, force: true });
  }, 15_000);

  it("a device is refused until the owner approves it, then runs a real-model turn", { timeout: 120_000 }, async () => {
    expect(await upgradeStatus(DEVICE_TOKEN), "a token nobody paired").toBe(401);

    const owner = new WebSocket(`ws://127.0.0.1:${port}/control`, { headers: { Authorization: `Bearer ${OWNER_TOKEN}` } });
    await new Promise<void>((resolve, reject) => {
      owner.once("open", () => resolve());
      owner.once("error", reject);
    });
    try {
      const { code } = await ask(owner, { type: "pair_code" });
      const pairing = await fetch(`http://127.0.0.1:${port}/control/pair`, {
        method: "POST",
        body: JSON.stringify({ code, name: "live laptop", token: DEVICE_TOKEN }),
      });
      expect(pairing.status).toBe(202);
      const { id } = (await pairing.json()) as { id: string };
      expect(await upgradeStatus(DEVICE_TOKEN), "a device waiting for approval").toBe(401);

      expect(await ask(owner, { type: "approve_device", id })).toEqual({ type: "device_approved", id, name: "live laptop" });
    } finally {
      owner.close();
    }

    expect(await upgradeStatus(DEVICE_TOKEN), "the approved device").toBe(101);
    const turn = await runControlTurn(port, DEVICE_TOKEN, "Reply with the single word: pong", 60_000);
    if (turn.status === "timeout") throw new Error(`no final frame within 60 s: ${JSON.stringify(turn.frames)}`);
    throwUnlessFinished(turn, output, [DEVICE_TOKEN]);
    expect(turn.text.trim().length).toBeGreaterThan(0);

    const stored = readFileSync(join(stateDir, "devices.json"), "utf8");
    expect(stored).not.toContain(DEVICE_TOKEN);
    expect(output).not.toContain(DEVICE_TOKEN);
  });
});
