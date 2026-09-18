import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { Container, ScopeViolationError } from "@theokit/di";
import { createAgentProvider } from "@theokit/di-agent";

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
   * What this docblock ALSO said, and got wrong: that the typed refusal was therefore unassertable
   * without that method. A reviewer refuted it by running the alternative — `ScopeViolationError`
   * is a public export, and composing the same two primitives reaches the refusal with no
   * production change. That test is now in the block below. The construction claim survives; the
   * dilemma built on top of it did not.
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

/**
 * The three tests below were added after a review round in which eight independent reviewers read
 * this slice. Each one pins something the original three could not see, and each failed before the
 * production change that accompanies it — the order matters, and it is recorded here because a test
 * written after the fix proves only that the fix is self-consistent.
 */
describe("what the first round of tests could not see", () => {
  /**
   * RED before `resolveAsync`. `AgentCompositionOptions.factory` is typed `() => TAgent |
   * Promise<TAgent>` and the canonical factory — `Agent.create` from `@theokit/sdk` — is async, so
   * this is not an edge case: it is the only shape a real consumer writes. Three reviewers reached
   * it independently by execution, and all three got `AsyncProviderInSyncResolveError`.
   */
  it("resolves an agent built by an async factory", async () => {
    const container = createContainer({ factory: async () => ({ id: "async-built" }) });

    const seen = await container.withAgent((agent) => agent.id);

    expect(seen).toBe("async-built");
  });

  /**
   * The refusal this module's docblock rests on, asserted rather than quoted.
   *
   * The original suite skipped it on the argument that reaching the error needed a production
   * escape hatch parsimony refuses. That argument is false, and a reviewer refuted it by running
   * the alternative: `ScopeViolationError` is a public export, and composing the same two
   * primitives this module composes reaches the refusal with no production change at all.
   *
   * `rules/testing.md` § 4 puts third-party libraries in the do-not-test column and API contracts
   * in the test column. This is the second: a documented ADR rests on this exact guarantee, so the
   * guarantee is ours to pin even though the code enforcing it is not.
   */
  it("refuses a request-scoped resolve outside a boundary, with the documented error", () => {
    const container = new Container();
    const provider = createAgentProvider<{ id: string }>({ factory: () => ({ id: "unreachable" }) });
    container.register(provider);

    expect(() => container.resolve(provider.provide)).toThrow(ScopeViolationError);
    expect(() => container.resolve(provider.provide)).toThrow(/runInRequest/);
  });

  /**
   * RED under `Scope.TRANSIENT`, green under `Scope.REQUEST`.
   *
   * A reviewer substituted TRANSIENT for the provider's default and all three original tests passed
   * unchanged — they prove the agent is not a SINGLETON, which TRANSIENT also satisfies. The
   * behaviour that separates the two is two resolves inside ONE boundary sharing one instance, and
   * `withAgent` resolves exactly once, so it is unreachable through this module's own surface.
   *
   * So the assertion is made against the provider this module registers, through the primitives it
   * registers it with. That is narrower than testing `withAgent`, and it is the widest claim the
   * shipped surface actually supports.
   */
  it("gives one boundary one agent, however many times it is resolved", async () => {
    const container = new Container();
    const provider = createAgentProvider<{ id: symbol }>({
      factory: () => ({ id: Symbol("per-boundary") }),
    });
    container.register(provider);

    const [first, second] = await container.runInRequest(async () => [
      await container.resolveAsync(provider.provide),
      await container.resolveAsync(provider.provide),
    ]);

    expect(first).toBe(second);
  });
});
