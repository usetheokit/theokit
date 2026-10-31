/**
 * B-376 T2.4 — the session store's interrupt against the REAL `@theokit/sdk` agent, offline. The
 * fakes honour the turn signal by construction; this proves the SDK does: aborting the signal a
 * session turn was sent with stops the provider request (a local `Run.cancel()` alone only moves the
 * status), and the next turn on the same agent still carries the earlier turn.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createTheoClawAgent, theoClawAgentOptions } from "../src/agent/create-agent.js";
import type { TurnAgent } from "../src/agent-port.js";
import { type ControlSessions, createControlSessions } from "../src/control-plane/control-sessions.js";
import { waitFor } from "./fakes.js";

interface HeldServer {
  readonly url: string;
  /** Every request body, parsed, in arrival order. */
  readonly bodies: Record<string, unknown>[];
  /** The held request: whether its socket was open once its body was read, and when it closed. */
  readonly held: { openAfterBody?: boolean; closedAt?: number; ended?: boolean };
  close(): Promise<void>;
}

function sse(text: string): string {
  const chunk = (delta: Record<string, unknown>, finish: string | null): string =>
    `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", created: 0, model: "stub", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return chunk({ role: "assistant", content: text }, null) + chunk({}, "stop") + "data: [DONE]\n\n";
}

/**
 * An OpenAI-compatible server that answers the first request, holds the second open until the client
 * goes away, and answers the third with the text of every message it was sent.
 */
async function startHeldServer(): Promise<HeldServer> {
  const bodies: Record<string, unknown>[] = [];
  const held: HeldServer["held"] = {};
  const answer = (request: IncomingMessage, response: ServerResponse, raw: string): void => {
    bodies.push(JSON.parse(raw) as Record<string, unknown>);
    const n = bodies.length;
    if (n === 2) {
      // `req.on('close')` fires once the body is consumed since Node 16, whether or not the
      // client went away; the socket is what tells.
      held.openAfterBody = !request.socket.destroyed;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      request.socket.once("close", () => {
        held.closedAt = Date.now();
        held.ended = response.writableEnded;
      });
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(sse(n === 1 ? "noted" : "remembered"));
  };
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (data: Buffer) => (raw += data.toString()));
    request.on("end", () => answer(request, response, raw));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    bodies,
    held,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function realSessions(): Promise<{ server: HeldServer; sessions: ControlSessions }> {
  const server = await startHeldServer();
  cleanups.push(() => server.close());
  const sessions = createControlSessions({
    build: async () =>
      (await createTheoClawAgent(
        theoClawAgentOptions({ model: { id: "lmstudio/stub", url: server.url }, apiKey: "stub-key" }),
      )) as TurnAgent,
    report: () => undefined,
  });
  cleanups.push(() => sessions.close());
  return { server, sessions };
}

describe("the real SDK agent on a control session (T2.4)", () => {
  it("an interrupt aborts the held model request within 2000 ms", async () => {
    const { server, sessions } = await realSessions();
    const me = {};
    expect(await sessions.run("s1", "the word is plain", () => undefined, me)).toEqual({ ok: true });
    const second = sessions.run("s1", "tell me a long story", () => undefined, me);
    await waitFor(() => server.held.openAfterBody !== undefined, 5000, "the second request to be held");
    expect(server.held.openAfterBody).toBe(true);
    const interruptedAt = Date.now();
    expect(sessions.interrupt("s1")).toBe("cancelled");
    expect(await second).toEqual({ ok: false, code: "interrupted" });
    await waitFor(() => server.held.closedAt !== undefined, 2000, "the held request's socket to close");
    expect(server.held.closedAt! - interruptedAt).toBeLessThan(2000);
    expect(server.held.ended).toBe(false);
  });

  it("the turn after an interrupt sends the earlier turn's text to the model", async () => {
    const { server, sessions } = await realSessions();
    const me = {};
    const word = `word-${randomUUID().slice(0, 8)}`;
    expect(await sessions.run("s1", `the word is ${word}`, () => undefined, me)).toEqual({ ok: true });
    const second = sessions.run("s1", "tell me a long story", () => undefined, me);
    await waitFor(() => server.held.openAfterBody !== undefined, 5000, "the second request to be held");
    sessions.interrupt("s1");
    await second;
    expect(await sessions.run("s1", "what was the word?", () => undefined, me)).toEqual({ ok: true });
    expect(server.bodies).toHaveLength(3);
    expect(JSON.stringify(server.bodies[2]?.messages)).toContain(word);
  });
});
