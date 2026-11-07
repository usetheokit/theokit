import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isIncognito, sessionAgentOptions } from "../src/control-plane/agent-factory.js";
import { withIncognitoCleanup } from "../src/sessions/chat-sessions.js";

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
});
