import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTauriChannelSource, type TauriChannel, type TauriCore } from "@theokit/tauri";
import { render } from "ink-testing-library";
import { createElement } from "react";
import { ChannelTransport, createAgentClient } from "theokit/client/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ControlClient, createControlClient } from "../../src/control-client/control-client.js";
import { TheoClawTui } from "../../src/tui/app.js";
import { waitFor } from "../fakes.js";
import { type HostToolsWorkspace, makeHostToolsWorkspace } from "../host-tools-workspace.js";

/**
 * AC-006 (B-376): OC-36 (desktop part) and H-1 against a real model, through the BUILT entries: one
 * started `dist/main.js`, the TUI rendered against it, and `dist/desktop/sidecar.js` spawned per turn
 * the way the desktop shell spawns it, behind `@theokit/tauri`'s transport. Both surfaces join one
 * session, so the conversation crosses them. Runs only with THEOCLAW_LIVE=1 and the model settings;
 * without the flag it skips, so CI stays offline. Build first: `pnpm --filter theoclaw run build`.
 */
const LIVE = process.env.THEOCLAW_LIVE === "1";
const APP_DIR = fileURLToPath(new URL("../..", import.meta.url));
const TOKEN = `live-control-token-${randomBytes(16).toString("hex")}`;
const SESSION = `owner-${randomBytes(4).toString("hex")}`;
const WORD = `zebra${randomBytes(3).toString("hex")}`;
const NOTE = `note-${randomBytes(4).toString("hex")}`;
const ASK_WORD =
  "Without using any tool, tell me the code word I gave you at the start of this conversation. Reply with the code word only.";
const MARKER = `Saga${randomBytes(3).toString("hex")}`;
// Long enough that the turn is still streaming when the surface stops it, even on a fast model; the
// marker opens the reply, so a test can tell the reply's text from the prompt that asked for it.
const LONG_ANSWER = `Without using any tool, write a story of at least 3000 words about a lighthouse keeper. Begin it with the word ${MARKER}. Do not stop early.`;

let instance: ChildProcess | undefined;
let output = "";
let port = 0;
let workspace: HostToolsWorkspace | undefined;
const clients: ControlClient[] = [];
const sidecars = new Set<ChildProcess>();

function instanceEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: workspace!.path,
    THEOCLAW_MODEL: process.env.THEOCLAW_MODEL,
    ...(process.env.THEOKIT_API_KEY ? { THEOKIT_API_KEY: process.env.THEOKIT_API_KEY } : {}),
    ...(process.env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } : {}),
  };
}

async function waitForOutput(pattern: RegExp, what: string): Promise<RegExpMatchArray> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const match = output.match(pattern);
    if (match !== null) return match;
    if (instance === undefined || instance.exitCode !== null) throw new Error(`the instance exited before ${what}: ${output}`);
    if (Date.now() > deadline) throw new Error(`no ${what} within 20 s: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The TUI rendered against the instance on SESSION, with a way to type and to read the screen. */
async function renderTui() {
  const client = await createControlClient({ url: `ws://127.0.0.1:${port}/control`, token: TOKEN });
  clients.push(client);
  const view = render(createElement(TheoClawTui, { client, session: SESSION, onExit: () => undefined }));
  const screen = (): string => view.lastFrame() ?? "";
  await waitFor(() => screen().includes("session"), 5000, "the TUI to draw its composer");
  // Keys typed before the composer mounted its input handler are lost.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const type = async (...keys: string[]): Promise<void> => {
    for (const key of keys) {
      view.stdin.write(key);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const running = (): boolean => screen().includes("esc to interrupt");
  /** Replies drawn so far: each assistant message starts with the marker `ChatMessage` draws. */
  const replies = (): number => screen().split("⏺").length - 1;
  /** Send one message and wait until its turn has drawn a reply and is no longer running. */
  const turn = async (message: string, what: string): Promise<void> => {
    const before = replies();
    await type(message, "\r");
    await waitFor(() => replies() > before && !running(), 120_000, `${what}; screen:\n${screen()}\ninstance:\n${output.slice(-3000)}`);
  };
  return { view, screen, type, running, replies, turn };
}

/**
 * The Tauri `core` the desktop webview gets, played by this test: `run_turn` spawns the built sidecar
 * on SESSION and pushes its stdout lines to the channel, as `lib.rs`'s `run_turn` does; `cancel_turn`
 * kills the live sidecar, as `lib.rs`'s `cancel_turn` does.
 */
function desktopCore(): TauriCore {
  let live: ChildProcess | undefined;
  const sidecarEntry = join(APP_DIR, "dist", "desktop", "sidecar.js");
  const invoke = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (cmd === "cancel_turn") {
      live?.kill("SIGKILL");
      live = undefined;
      return undefined;
    }
    if (cmd !== "run_turn") throw new Error(`unexpected command ${cmd}`);
    live?.kill("SIGKILL");
    const child = spawn(process.execPath, [sidecarEntry, String(args?.message)], {
      env: { ...instanceEnv(), THEOCLAW_PORT: String(port), THEOCLAW_CONTROL_TOKEN: TOKEN, THEOCLAW_SESSION: SESSION },
      stdio: ["ignore", "pipe", "pipe"],
    });
    live = child;
    sidecars.add(child);
    const channel = args?.onChunk as TauriChannel;
    child.stdout!.on("data", (chunk: Buffer) => channel.onmessage(chunk.toString()));
    await new Promise((resolve) => child.once("exit", resolve));
    sidecars.delete(child);
    return undefined;
  };
  class Channel implements TauriChannel {
    onmessage: (line: string) => void = () => undefined;
  }
  return { invoke, Channel };
}

/** The text of a client's latest assistant message. */
function assistantText(message: { parts?: readonly { type: string; text?: string }[] } | undefined): string {
  return (message?.parts ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
}

describe.skipIf(!LIVE)("the TUI and the desktop on one running instance, against a real model", () => {
  beforeAll(async () => {
    if (!process.env.THEOCLAW_MODEL || !(process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY)) {
      throw new Error("THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY");
    }
    for (const entry of ["main.js", "desktop/sidecar.js"]) {
      const path = join(APP_DIR, "dist", entry);
      if (!existsSync(path)) throw new Error(`${path} is missing: run pnpm --filter theoclaw run build`);
    }
    workspace = makeHostToolsWorkspace();
    mkdirSync(join(workspace.path, "files"), { mode: 0o700 });
    writeFileSync(join(workspace.path, "files", "notes.txt"), NOTE);
    instance = spawn(process.execPath, [join(APP_DIR, "dist", "main.js")], {
      cwd: workspace.path,
      env: {
        ...instanceEnv(),
        THEOCLAW_PORT: "0",
        THEOCLAW_CONTROL_TOKEN: TOKEN,
        THEOCLAW_OWNERS: "telegram:owner",
        THEOCLAW_DM_POLICY: "allowlist",
        THEOCLAW_WORKSPACE: workspace.path,
        THEOCLAW_HOST_TOOLS: "on",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    instance.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    instance.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const [, bound] = await waitForOutput(/theoclaw: control plane listening on 127\.0\.0\.1:(\d+)/, "the listening line");
    port = Number(bound);
    // The code word is given once, through the TUI, in a turn that completes.
    const tui = await renderTui();
    await tui.turn(`Remember this code word for later: ${WORD}. Reply with the single word ok.`, "the first turn");
    tui.view.unmount();
  }, 150_000);

  afterAll(async () => {
    for (const child of sidecars) child.kill("SIGKILL");
    for (const client of clients.splice(0)) await client.close().catch(() => undefined);
    if (instance !== undefined && instance.exitCode === null && instance.signalCode === null) {
      const gone = new Promise((resolve) => instance!.once("exit", resolve));
      instance.kill("SIGINT");
      const timer = setTimeout(() => instance!.kill("SIGKILL"), 5_000);
      await gone;
      clearTimeout(timer);
    }
    workspace?.remove();
  }, 20_000);

  it("the TUI and the desktop share one conversation, each interrupted and redirected, for H-1", { timeout: 240_000 }, async () => {
    const tui = await renderTui();
    await tui.type(
      `Use the read_file tool to read notes.txt. Then, with no other tool and without writing any file, ${LONG_ANSWER.replace("Without using any tool, w", "w")} Write the story in your reply.`,
      "\r",
    );
    // A tool card, then text as it is generated: Esc lands while the turn still streams.
    await waitFor(() => tui.screen().includes("read_file"), 90_000, `the tool card; screen:\n${tui.screen()}`);
    // The marker once in the prompt, once more when the reply's text has begun streaming.
    await waitFor(() => tui.screen().split(MARKER).length > 2, 90_000, `streamed text after the tool; screen:\n${tui.screen()}`);
    await tui.type("\u001B");
    await waitFor(() => tui.screen().includes("interrupted"), 10_000, `the turn shown interrupted; screen:\n${tui.screen()}`);
    await waitFor(() => !tui.running(), 10_000, "the interrupted turn to settle");
    await tui.turn(ASK_WORD, "the redirect");
    expect(tui.screen()).toContain(WORD);
    tui.view.unmount();
  });

  it("the desktop reaches the running instance through @theokit/tauri, interrupted and redirected, for OC-36", { timeout: 240_000 }, async () => {
    const client = createAgentClient<{ message: string }>(
      new ChannelTransport({ source: createTauriChannelSource(desktopCore(), { cancelCommand: "cancel_turn" }) }),
    );
    // Turn 1: the word the TUI gave crossed to the desktop, on the same session.
    let first: Parameters<typeof assistantText>[0];
    for await (const message of client.stream({ message: ASK_WORD })) first = message;
    expect(assistantText(first)).toContain(WORD);

    // Turn 2: a long answer, aborted after its first text, as a stop button does.
    const before = output.split("turn interrupted").length;
    client.send({ message: LONG_ANSWER });
    await waitFor(
      () => assistantText(client.getState().messages.at(-1)).length > 0,
      90_000,
      "the first text of the long answer",
    );
    client.abort();

    // Turn 3: the redirect, sent at once, as a person would.
    let third: Parameters<typeof assistantText>[0];
    for await (const message of client.stream({ message: ASK_WORD })) third = message;
    expect(assistantText(third)).toContain(WORD);
    expect(JSON.stringify(client.getState())).not.toContain("busy");
    // The instance stopped the turn: its stderr line is evidence, read after the fact.
    expect(output).toContain(`theoclaw: control session ${SESSION} turn interrupted`);
    expect(output.split("turn interrupted").length).toBeGreaterThan(before);
  });
});
