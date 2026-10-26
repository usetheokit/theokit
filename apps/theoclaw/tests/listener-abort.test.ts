import { request as httpRequest } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { type ControlPlaneHandle, listenControlPlane } from "../src/control-plane/listener.js";

const stderrLines: string[] = [];
const stderr = (line: string): void => void stderrLines.push(line);
let handle: ControlPlaneHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  stderrLines.length = 0;
});

/** Wait for a condition, never for a guessed duration (rules/testing.md § 3). */
async function waitFor(condition: () => boolean, what: string, deadlineMs = 1000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`within ${deadlineMs} ms: ${what} never happened`);
    await new Promise((settle) => setTimeout(settle, 5));
  }
}

function url(path: string): string {
  const { host, port } = handle!.address();
  return `http://${host}:${port}${path}`;
}

/**
 * A body that sends one chunk and then nothing more, like a turn waiting on a silent model. It ends
 * when the request's signal aborts, so the writer's pending read settles and nothing is left hanging.
 */
function silentBody(signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("first chunk\n"));
      signal.addEventListener("abort", () => controller.close(), { once: true });
    },
  });
}

/** AC-004 (B-368, plan D3): the app's listener gives each request a signal that its client's departure aborts. */
describe("the listener's per-request signal", () => {
  it("aborts when the client destroys its socket mid-response", async () => {
    let seen: Request | undefined;
    handle = await listenControlPlane({
      handler: async (request) => {
        seen = request;
        return new Response(silentBody(request.signal), { headers: { "content-type": "text/plain" } });
      },
      port: 0,
      host: "127.0.0.1",
      stderr,
    });

    await new Promise<void>((resolve) => {
      const client = httpRequest(url("/stream"), { agent: false }, (response) => {
        response.once("data", () => {
          client.destroy();
          resolve();
        });
      });
      // Destroying the request mid-response is the point; the client's own reset error is expected.
      client.on("error", () => undefined);
      client.on("close", () => resolve());
      client.end();
    });

    await waitFor(() => seen?.signal.aborted === true, "the handler's request signal aborting");
  });

  // Must-not-regress guards: green before the change, and the change must keep them green.
  it("stays unaborted after a response that finished", async () => {
    let seen: Request | undefined;
    handle = await listenControlPlane({
      handler: async (request) => {
        seen = request;
        return new Response("done");
      },
      port: 0,
      host: "127.0.0.1",
      stderr,
    });

    const response = await fetch(url("/finished"), { headers: { connection: "close" } });
    expect(await response.text()).toBe("done");
    // A finished response emits `close` after `finish`; closing the server makes that happen now.
    await handle.close();
    handle = undefined;
    expect(seen?.signal.aborted).toBe(false);
  });

  it("delivers a POST body intact through the rebuilt request", async () => {
    let body: unknown;
    handle = await listenControlPlane({
      handler: async (request) => {
        body = await request.json();
        return new Response(null, { status: 204 });
      },
      port: 0,
      host: "127.0.0.1",
      stderr,
    });

    const response = await fetch(url("/echo"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello", nested: { n: 1 } }),
    });

    expect(response.status).toBe(204);
    expect(body).toEqual({ message: "hello", nested: { n: 1 } });
  });
});
