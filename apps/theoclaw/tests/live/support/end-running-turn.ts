import WebSocket from "ws";

import { waitFor } from "../../fakes.js";

/**
 * Stop whatever turn `session` still runs on the instance at `url` and wait until it has unwound. A
 * test that failed mid-turn leaves its turn running, and the next client's first message would answer
 * `busy` (#1418). Interrupts through a socket of its own until the instance answers `no_turn`.
 */
export async function endRunningTurn(options: {
  readonly url: string;
  readonly token: string;
  readonly session: string;
  readonly context?: () => string;
  readonly timeoutMs?: number;
}): Promise<void> {
  const socket = new WebSocket(options.url, { headers: { Authorization: `Bearer ${options.token}` } });
  const types: string[] = [];
  socket.on("message", (raw) => void types.push((JSON.parse(String(raw)) as { type: string }).type));
  socket.on("error", () => undefined);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const timeoutMs = options.timeoutMs ?? 15_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      types.length = 0;
      socket.send(JSON.stringify({ type: "interrupt", session: options.session }));
      await waitFor(() => types.length > 0, 5_000, "an answer to the interrupt");
      if (types[0] === "no_turn") return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`the turn on ${options.session} still runs ${timeoutMs} ms after an interrupt; instance:\n${options.context?.() ?? ""}`);
  } finally {
    socket.terminate();
  }
}
