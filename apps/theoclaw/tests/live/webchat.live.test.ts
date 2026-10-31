import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AgentClient, HttpTransport } from "@theokit/agents/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WEBCHAT_API, webchatAgentOptions } from "../../web/agent-options.js";

/**
 * AC-007 (B-368): OC-12 against a real model, through the BUILT entry (`dist/main.js`) and the page's
 * own transport configuration (`web/agent-options.ts`, what the page hands `useAgent`), driven by
 * the same client store `useAgent` wraps. This host has no browser (plan D5), so this run is the
 * dated real-model WebChat conversation. It runs only with THEOCLAW_LIVE=1 and the model settings in
 * the environment; without the flag it skips, so CI stays offline. Build first:
 * `pnpm --filter theoclaw run build && pnpm --filter theoclaw run build:web`.
 */
const LIVE = process.env.THEOCLAW_LIVE === "1";
const APP_DIR = fileURLToPath(new URL("../..", import.meta.url));
// 32 hex-character bytes, prefixed: well over the 32-character minimum.
const TOKEN = `live-webchat-token-${randomBytes(16).toString("hex")}`;

let child: ChildProcess | undefined;
let output = "";
let base = "";
let home = "";

async function waitForOutput(pattern: RegExp, what: string): Promise<RegExpMatchArray> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const match = output.match(pattern);
    if (match !== null) return match;
    if (child === undefined || child.exitCode !== null) throw new Error(`the entry exited before ${what}: ${output}`);
    if (Date.now() > deadline) throw new Error(`no ${what} within 15 s: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe.skipIf(!LIVE)("WebChat against a real model", () => {
  beforeAll(async () => {
    const modelKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY;
    if (!process.env.THEOCLAW_MODEL || !modelKey) {
      throw new Error("THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY");
    }
    const entry = join(APP_DIR, "dist", "main.js");
    if (!existsSync(entry)) throw new Error(`${entry} is missing: run pnpm --filter theoclaw run build`);
    home = mkdtempSync(join(tmpdir(), "theoclaw-live-webchat-"));
    child = spawn(process.execPath, [entry], {
      cwd: APP_DIR,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        THEOCLAW_MODEL: process.env.THEOCLAW_MODEL,
        ...(process.env.THEOKIT_API_KEY ? { THEOKIT_API_KEY: process.env.THEOKIT_API_KEY } : {}),
        ...(process.env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } : {}),
        THEOCLAW_PORT: "0",
        THEOCLAW_WEBCHAT_TOKEN: TOKEN,
        // Every start needs an owner (B-371) and a workspace (B-378), as control-plane.live.test.ts has.
        THEOCLAW_OWNERS: "telegram:owner",
        THEOCLAW_DM_POLICY: "allowlist",
        THEOCLAW_WORKSPACE: home,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const [, bound] = await waitForOutput(/theoclaw: control plane listening on 127\.0\.0\.1:(\d+)/, "the listening line");
    base = `http://127.0.0.1:${bound}`;
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

  it("a real-model conversation through the page's transport to the started process", { timeout: 90_000 }, async () => {
    const page = await fetch(`${base}/webchat`);
    expect(page.status, "GET /webchat: run build:web if this is 503").toBe(200);
    const html = await page.text();
    expect(html).toContain("/webchat/assets/app.js");
    expect(html).toContain("/webchat/assets/app.css");

    const client = new AgentClient(new HttpTransport({ api: `${base}${WEBCHAT_API}`, headers: webchatAgentOptions(TOKEN).headers }));
    client.send({ message: "Reply with the single word: pong" });
    const deadline = Date.now() + 60_000;
    while (client.getSnapshot().status === "streaming" || client.getSnapshot().status === "idle") {
      if (Date.now() > deadline) throw new Error(`no answer within 60 s: ${JSON.stringify(client.getSnapshot())}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const snapshot = client.getSnapshot();
    expect(snapshot.status, `error: ${String(snapshot.error)}; output: ${output}`).toBe("done");
    const assistantText = snapshot.thread
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");
    expect(assistantText.trim(), `thread: ${JSON.stringify(snapshot.thread)}`).not.toBe("");
    expect(output).not.toContain(TOKEN);
  });
});
