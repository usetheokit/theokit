import { describe, expect, it } from "vitest";

import { assistant, deferred, FakeAgent, finished } from "./fakes.js";

/** Drain an async iterable into an array. */
async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("the fake run honours the turn signal (T2.1)", () => {
  it("an aborted signal ends a held fake stream within 2000 ms and wait resolves cancelled", async () => {
    const held = deferred<void>();
    const agent = new FakeAgent({ frames: [assistant("never")], before: held.promise });
    const controller = new AbortController();
    const run = await agent.send("hi", { signal: controller.signal });
    const started = Date.now();
    const frames = drain(run.stream());
    controller.abort();
    expect(await frames).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await run.wait()).toEqual({ status: "cancelled" });
    expect(agent.signals[0]).toBe(controller.signal);
  });

  it("events yields the text deltas, then the messages marked textAlreadyStreamed", async () => {
    const agent = new FakeAgent({ frames: [assistant("Hello"), finished()], deltas: ["Hel", "lo"] });
    const run = await agent.send("hi", { signal: new AbortController().signal });
    const events = await drain(run.events());
    expect(events.map((e) => e.kind)).toEqual(["delta", "delta", "message", "message"]);
    expect(events[2]).toMatchObject({ kind: "message", textAlreadyStreamed: true });
  });
});
