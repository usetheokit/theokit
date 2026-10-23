import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

/**
 * AC-006 (B-372): OC-22 and OC-23 against a real model, through the BUILT entry (`dist/main.js`),
 * so the check proves the process an operator starts, its own agent factory included (plan D4).
 * It runs only with THEOCLAW_LIVE=1 and the model settings in the environment; without the flag
 * it skips, so CI stays offline. Build first: `pnpm --filter theoclaw run build`.
 */
const LIVE = process.env.THEOCLAW_LIVE === "1";
const APP_DIR = fileURLToPath(new URL("../..", import.meta.url));
const TOKEN = `live-control-token-${randomBytes(16).toString("hex")}`;

let child: ChildProcess | undefined;
let output = "";
let port = 0;
let home = "";

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

describe.skipIf(!LIVE)("the control plane against a real model", () => {
  beforeAll(async () => {
    const modelKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY;
    if (!process.env.THEOCLAW_MODEL || !modelKey) {
      throw new Error("THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY");
    }
    const entry = join(APP_DIR, "dist", "main.js");
    if (!existsSync(entry)) throw new Error(`${entry} is missing: run pnpm --filter theoclaw run build`);
    // The SDK writes session files under HOME; a scratch HOME keeps the run off the operator's.
    home = mkdtempSync(join(tmpdir(), "theoclaw-live-"));
    child = spawn(process.execPath, [entry], {
      cwd: APP_DIR,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        THEOCLAW_MODEL: process.env.THEOCLAW_MODEL,
        ...(process.env.THEOKIT_API_KEY ? { THEOKIT_API_KEY: process.env.THEOKIT_API_KEY } : {}),
        ...(process.env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } : {}),
        THEOCLAW_PORT: "0",
        THEOCLAW_CONTROL_TOKEN: TOKEN,
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

  it("a real-model turn over the control WebSocket of the started process", { timeout: 90_000 }, async () => {
    expect(output).toMatch(/control plane listening on 127\.0\.0\.1:/);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/control`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const frames: Array<Record<string, unknown>> = [];
    socket.on("message", (raw) => frames.push(JSON.parse(String(raw)) as Record<string, unknown>));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const isFinal = (frame: Record<string, unknown>) =>
      frame.type === "done" || (frame.type === "error" && frame.code === "turn_failed");

    socket.send(JSON.stringify({ type: "chat", message: "Reply with the single word: pong" }));
    const deadline = Date.now() + 60_000;
    while (!frames.some(isFinal)) {
      if (Date.now() > deadline) throw new Error(`no final frame within 60 s: ${JSON.stringify(frames)}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const countAtEnd = frames.length;
    // Anything after the final frame would be a second ending; 500 ms is the window the plan names.
    await new Promise((resolve) => setTimeout(resolve, 500));
    socket.close();

    const texts = frames
      .filter((frame) => frame.type === "event")
      .map((frame) => frame.event as { type: string; content?: unknown })
      .filter((event) => event.type === "text_delta" && typeof event.content === "string" && event.content.trim() !== "");
    expect(texts.length, `frames: ${JSON.stringify(frames)}`).toBeGreaterThan(0);
    expect(frames.filter(isFinal)).toEqual([{ type: "done" }]);
    expect(frames.length).toBe(countAtEnd);
  });

  it("the started process answers GET /health on its port and is unreachable on the host's non-loopback address", { timeout: 30_000 }, async () => {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const addresses = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => entry.address);
    if (addresses.length === 0) {
      throw new Error("no non-loopback IPv4 address on this host; the OC-23 check did not run");
    }
    for (const address of addresses) {
      const code = await new Promise<string>((resolve) => {
        const socket = connect({ host: address, port });
        // A firewall that drops instead of refusing would otherwise hang until the test timeout.
        socket.setTimeout(3_000, () => {
          socket.destroy();
          resolve("timeout");
        });
        socket.once("connect", () => {
          socket.destroy();
          resolve("connected");
        });
        socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
      });
      expect(code, `connecting to ${address}:${port}`).toBe("ECONNREFUSED");
    }
  });
});
