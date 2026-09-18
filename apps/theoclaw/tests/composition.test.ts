import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { createContainer } from "../src/composition.js";

/**
 * B-004, DoD bullet 1 — "an agent is request-scoped through `createAgentProvider`, proven by two
 * concurrent requests not sharing state".
 *
 * The bullet says PROVEN BY TWO CONCURRENT REQUESTS, so the test resolves twice and compares.
 * Asserting that the provider was configured with `Scope.REQUEST` would test the configuration
 * rather than the behaviour, and a default that stopped being honoured would still pass.
 */
describe("the composition root", () => {
  it("gives two concurrent requests two different agents", async () => {
    const container = createContainer({ factory: () => ({ id: Symbol("agent") }) });

    const [first, second] = await Promise.all([
      container.withAgent((agent) => agent),
      container.withAgent((agent) => agent),
    ]);

    expect(first).not.toBe(second);
  });

  it("does not share mutated state between two requests", async () => {
    const container = createContainer({ factory: () => ({ seen: [] as string[] }) });

    await container.withAgent((agent) => agent.seen.push("from the first request"));
    const secondRequestSaw = await container.withAgent((agent) => agent.seen);

    expect(secondRequestSaw).toEqual([]);
  });
  /**
   * B-004 T1.1 — FR-004 says a caller asking for an agent outside a request is refused. Writing
   * that test revealed something better than a passing assertion: **through this module's public
   * surface the situation cannot arise.**
   *
   * `createContainer` returns one key, and that key always wraps its work in `runInRequest`. The
   * container never escapes, so there is no caller-reachable path to an unbounded resolve. The
   * first draft of this test invented a `resolveOutsideBoundaryForTest()` to reach one — a
   * production method existing only for a test, which the parsimony ladder refuses before its
   * sixth rung.
   *
   * So the requirement is met by CONSTRUCTION rather than by a guard, and this is what pins the
   * construction: the day a second key appears on that object, this fails and someone has to
   * argue for it.
   */
  it("exposes no way to resolve outside a request boundary", () => {
    const container = createContainer({ factory: () => ({ id: Symbol("agent") }) });

    expect(Object.keys(container)).toEqual(["withAgent"]);
  });
});
