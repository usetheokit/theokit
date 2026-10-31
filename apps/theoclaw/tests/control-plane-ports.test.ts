import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:net";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { startTheoClaw } from "../src/composition.js";
import { TheoClawBindError } from "../src/control-plane/errors.js";
import type { ControlPlaneHandle } from "../src/control-plane/listener.js";
import { WORKSPACE } from "./composition-fixtures.js";

// Each start makes its tool root `files/` in its working directory (B-382): a scratch one, never the checkout.
const TOOL_CWD = mkdtempSync(join(tmpdir(), "theoclaw-start-"));
afterAll(() => rmSync(TOOL_CWD, { recursive: true, force: true }));


const handles: ControlPlaneHandle[] = [];
const holders: Server[] = [];
let agentsBuilt = 0;

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
  for (const holder of holders.splice(0)) await new Promise((resolve) => holder.close(resolve));
  agentsBuilt = 0;
});

/** A free loopback port: bound on 0 by a probe server, read, and released before use. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  if (address === null || typeof address === "string") throw new Error("the probe did not bind a TCP port");
  return address.port;
}

function start(port: number): Promise<ControlPlaneHandle> {
  return startTheoClaw({
    cwd: TOOL_CWD,
    env: {
      THEOCLAW_MODEL: "m",
      OPENROUTER_API_KEY: "k",
      THEOCLAW_PORT: String(port),
      THEOCLAW_OWNERS: "telegram:owner",
      THEOCLAW_DM_POLICY: "allowlist",
      THEOCLAW_WORKSPACE: WORKSPACE,
    },
    agentFactory: () => {
      agentsBuilt += 1;
      return { send: () => Promise.reject(new Error("no turn in these tests")) };
    },
    stdout: () => undefined,
    stderr: () => undefined,
    // No stream to mask: the real process streams would keep one mask per start in this worker.
    streams: [],
    signals: new EventEmitter(),
    exit: () => undefined,
  }).then((handle) => {
    handles.push(handle);
    return handle;
  });
}

/** AC-005 (B-372), the port half of OC-28: instances on their own ports, a busy port refused by name. */
describe("two TheoClaw instances", () => {
  it("two starts on distinct ports each report their own port", async () => {
    const first = await freePort();
    let second = await freePort();
    while (second === first) second = await freePort();

    const [a, b] = await Promise.all([start(first), start(second)]);

    expect(a.address().port).toBe(first);
    expect(b.address().port).toBe(second);
    expect(a.address().port).not.toBe(b.address().port);
  });

  it("a start on a port already in use ends with TheoClawBindError naming the port and builds no agent", async () => {
    const holder = createServer();
    holders.push(holder);
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const address = holder.address();
    if (address === null || typeof address === "string") throw new Error("the holder did not bind a TCP port");

    const attempt = start(address.port);

    await expect(attempt).rejects.toThrow(TheoClawBindError);
    await expect(attempt).rejects.toThrow(new RegExp(`port ${address.port}`));
    expect(agentsBuilt).toBe(0);
  });
});
