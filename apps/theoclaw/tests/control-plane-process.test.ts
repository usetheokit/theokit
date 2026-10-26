import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
// The entry makes its tool root `files/` in its working directory (B-382), so it runs in a scratch
// directory rather than the checkout; the entry and the tsx loader are named by absolute path.
const ENTRY = join(APP_DIR, "src", "main.ts");
const TSX_LOADER = import.meta.resolve("tsx");
let workspace: string | undefined;
const MODEL_KEY = `model-key-${randomBytes(8).toString("hex")}`;
const TOKEN = `control-token-${randomBytes(16).toString("hex")}`; // 46 characters

interface Run {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

let running: ChildProcess | undefined;

afterEach(async () => {
  const child = running;
  running = undefined;
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    const gone = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await gone;
  }
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

const COMPLETE_ENV: Readonly<Record<string, string | undefined>> = {
  THEOCLAW_MODEL: "stub",
  OPENROUTER_API_KEY: MODEL_KEY,
  THEOCLAW_PORT: "0",
  THEOCLAW_CONTROL_TOKEN: TOKEN,
  THEOCLAW_OWNERS: "telegram:owner",
  THEOCLAW_DM_POLICY: "allowlist",
};

/**
 * The process entry under tsx, from the app's directory, with only the variables it needs.
 * `overrides` replaces a variable; an `undefined` value leaves it unset.
 */
function spawnEntry(overrides: Readonly<Record<string, string | undefined>> = {}): Run {
  const variables = Object.entries({ ...COMPLETE_ENV, ...overrides }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  workspace = mkdtempSync(join(tmpdir(), "theoclaw-entry-"));
  const child = spawn(process.execPath, ["--import", TSX_LOADER, ENTRY], {
    cwd: workspace,
    env: { PATH: process.env.PATH, ...Object.fromEntries(variables) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  running = child;
  let output = "";
  child.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  return { child, output: () => output, exited };
}

/** Polls the collected output until `pattern` appears; fails naming what never did. */
async function waitForLine(run: Run, pattern: RegExp): Promise<RegExpMatchArray> {
  // 30 s: the entry loads the ten gateway SDKs as well as the control plane (about 2.5 s under
  // tsx on an idle machine), and the 10 s bound this had was exceeded under a load average of 20.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const match = run.output().match(pattern);
    if (match !== null) return match;
    if (run.child.exitCode !== null) throw new Error(`the entry exited ${run.child.exitCode}: ${run.output()}`);
    if (Date.now() > deadline) throw new Error(`no line matching ${pattern} within 30 s: ${run.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** AC-008 (B-372): the process entry, observed from outside the process. */
describe("the process entry", () => {
  it("the process entry listens on 127.0.0.1 and exits 0 on SIGINT", { timeout: 45_000 }, async () => {
    const run = spawnEntry();

    const [, port] = await waitForLine(run, /theoclaw: control plane listening on 127\.0\.0\.1:(\d+)/);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    run.child.kill("SIGINT");

    expect(await run.exited).toEqual({ code: 0, signal: null });
  });

  it("the process entry prints neither the control token nor the model key", { timeout: 45_000 }, async () => {
    const run = spawnEntry();

    await waitForLine(run, /control plane listening on/);
    run.child.kill("SIGINT");
    await run.exited;

    expect(run.output()).not.toContain(TOKEN);
    expect(run.output()).not.toContain(MODEL_KEY);
  });

  it("the process entry refuses a missing THEOCLAW_MODEL with exit 1 and names the variable", { timeout: 20_000 }, async () => {
    const run = spawnEntry({ THEOCLAW_MODEL: undefined });

    expect(await run.exited).toEqual({ code: 1, signal: null });
    expect(run.output()).toMatch(/^theoclaw: .*THEOCLAW_MODEL/m);
    expect(run.output()).not.toContain(MODEL_KEY);
    expect(run.output()).not.toContain(TOKEN);
  });

  it("the process entry refuses a public bind without THEOCLAW_PUBLIC_BIND with exit 1", { timeout: 20_000 }, async () => {
    const run = spawnEntry({ THEOCLAW_HOST: "0.0.0.0" });

    expect(await run.exited).toEqual({ code: 1, signal: null });
    expect(run.output()).toMatch(/^theoclaw: refusing to bind 0\.0\.0\.0: .*THEOCLAW_PUBLIC_BIND=yes/m);
    expect(run.output()).not.toContain(MODEL_KEY);
    expect(run.output()).not.toContain(TOKEN);
  });
});
