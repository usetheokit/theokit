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
});
