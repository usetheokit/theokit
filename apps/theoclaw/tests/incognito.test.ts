import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { isIncognito, sessionAgentOptions } from "../src/control-plane/agent-factory.js";
import { createProgressGate } from "../src/channels/progress.js";
import { chatSessions, withIncognitoCleanup } from "../src/sessions/chat-sessions.js";

const ENV = { THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: "k" };

describe("incognito sessions (OC-92)", () => {
  it("reads THEOCLAW_INCOGNITO as on or off", () => {
    expect(isIncognito(ENV)).toBe(false);
    expect(isIncognito({ ...ENV, THEOCLAW_INCOGNITO: "off" })).toBe(false);
    expect(isIncognito({ ...ENV, THEOCLAW_INCOGNITO: "on" })).toBe(true);
    expect(() => isIncognito({ ...ENV, THEOCLAW_INCOGNITO: "yes" })).toThrow("THEOCLAW_INCOGNITO");
  });

  it("keeps the transcript out of the workspace and drops telemetry", () => {
    const options = sessionAgentOptions(
      { ...ENV, THEOCLAW_INCOGNITO: "on", THEOCLAW_OTEL: "on", OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
      "/ws",
    );
    expect(options.local.sessionDir.startsWith("/ws")).toBe(false);
    expect(options.local.sessionDir.startsWith(tmpdir())).toBe(true);
    expect(options).not.toHaveProperty("telemetry");
  });

  it("is unchanged without it", () => {
    expect(sessionAgentOptions(ENV, "/ws").local.sessionDir).toBe("/ws/.theoclaw");
  });

  it("removes the private directory when the agent is disposed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "theoclaw-incognito-"));
    let disposed = false;
    const agent = withIncognitoCleanup(
      { dispose: async () => void (disposed = true) } as unknown as Parameters<typeof withIncognitoCleanup>[0],
      dir,
    );
    await agent.dispose();
    expect(disposed).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it("never removes a directory outside the temp root", async () => {
    const dir = mkdtempSync(join(process.cwd(), ".incognito-guard-"));
    const agent = withIncognitoCleanup({ dispose: async () => undefined } as unknown as Parameters<typeof withIncognitoCleanup>[0], dir);
    await agent.dispose();
    expect(existsSync(dir)).toBe(true);
    (await import("node:fs")).rmSync(dir, { recursive: true });
  });

  it("opens a session agent in a temp directory and removes it at dispose", async () => {
    const dir = mkdtempSync(join(tmpdir(), "theoclaw-ws-"));
    const seen: string[] = [];
    const { sessions, withAgent } = chatSessions({
      env: { ...ENV, THEOCLAW_INCOGNITO: "on", THEOCLAW_WORKSPACE: dir },
      write: () => undefined,
      getOrCreate: async (_id, options) => {
        const sessionDir = options.local?.sessionDir as string;
        seen.push(sessionDir);
        mkdirSync(sessionDir, { recursive: true });
        return { send: () => { throw new Error("no turn"); }, dispose: async () => undefined } as never;
      },
    });
    const event = { platform: "telegram", sender: { id: "u" }, channel: { type: "dm", id: "u" } } as unknown as MessageEvent;
    await withAgent(event, (lease) => lease.release());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.startsWith(dir)).toBe(false);
    expect(existsSync(seen[0]!)).toBe(true);
    await sessions.disposeAll();
    expect(existsSync(seen[0]!)).toBe(false);
  });

  it("sends no tool input, status detail or reasoning in progress lines", () => {
    const display = { tool_progress: "all", live_status: "full", cleanup_progress: true, show_reasoning: true, reasoning_style: "plain", streaming: true, tool_preview_length: 40 } as const;
    const events = [
      { type: "reasoning", text: "secret thoughts" },
      { type: "tool-call", name: "read", input: { path: "/secret" } },
      { type: "status", status: "working", detail: "secret detail" },
    ] as never[];
    const run = (incognito: boolean): string => {
      const gate = createProgressGate(display, incognito);
      return [...events.flatMap((e) => gate.lines(e)), ...gate.flush()].join("\n");
    };
    expect(run(false)).toContain("secret");
    expect(run(true)).not.toContain("secret");
    expect(run(true)).toContain("read");
  });
});
