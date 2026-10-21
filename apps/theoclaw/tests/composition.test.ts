import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { Container, ScopeViolationError } from "@theokit/di";
import { createAgentProvider } from "@theokit/di-agent";

import { createContainer } from "../src/composition.js";

import { createHmac } from 'node:crypto'

import type { WhatsAppMessageEvent } from '@theokit/gateway'

import { composeTheoClaw } from '../src/composition.js'
import { MAX_BODY_BYTES } from '../src/webhooks/router.js'
import type { TeamsVerifier } from '../src/webhooks/teams.js'
import { chunkedPost, fakeBuilders, noAgent, signedLinePost, TELEGRAM_AND_LINE } from './composition-fixtures.js'
import { FakeAdapter, deferred, waitFor } from './fakes.js'

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

describe('composeTheoClaw', () => {
  it('composes one runner per configured platform and serves its route', async () => {
    const { builders } = fakeBuilders()
    const lines: string[] = []
    const { loop, router } = composeTheoClaw({ env: TELEGRAM_AND_LINE, agentFactory: noAgent, builders, write: (line) => lines.push(line) })

    await loop.ready

    expect(loop.started.size).toBe(2)
    expect((await router(signedLinePost())).status).toBe(200)
    expect((await router(new Request('http://localhost/webhooks/sms', { method: 'POST', body: 'x' }))).status).toBe(404)
    expect(lines).toContain(
      'slack: not configured (missing THEOCLAW_SLACK_BOT_TOKEN, THEOCLAW_SLACK_APP_TOKEN)',
    )
    await loop.stopAll()
  })

  it('serves a route before a slow platform has connected', async () => {
    const held = deferred<boolean>()
    const { builders } = fakeBuilders({ telegram: new FakeAdapter('telegram', { connect: () => held.promise }) })
    const { loop, router } = composeTheoClaw({ env: TELEGRAM_AND_LINE, agentFactory: noAgent, builders, write: () => undefined })
    await waitFor(() => loop.started.has('line'), 1000, 'the LINE runner to start')

    const response = await router(signedLinePost())

    expect(response.status).toBe(200)
    expect(loop.started.has('telegram')).toBe(false)
    held.resolve(true)
    await loop.ready
    await loop.stopAll()
  })

  it('a chunked oversized sms post never reaches the verifier', async () => {
    const sms = new (class extends FakeAdapter {
      verifications = 0
      verifySignature(): boolean {
        this.verifications += 1
        return true
      }
    })('sms')
    const { builders } = fakeBuilders({ sms })
    const env = {
      THEOCLAW_SMS_TWILIO_ACCOUNT_SID: 'AC-x',
      THEOCLAW_SMS_TWILIO_AUTH_TOKEN: 'auth-token',
      THEOCLAW_SMS_TWILIO_FROM_NUMBER: '+15550000000',
      THEOCLAW_SMS_PUBLIC_URL: 'https://example.org/webhooks/sms',
    }
    const { loop, router } = composeTheoClaw({ env, agentFactory: noAgent, builders, write: () => undefined })
    await loop.ready

    const response = await router(chunkedPost('/webhooks/sms', MAX_BODY_BYTES + 1))

    expect(response.status).toBe(413)
    expect(sms.verifications).toBe(0)
    await loop.stopAll()
  })
})

const WHATSAPP_ENV = {
  THEOCLAW_WHATSAPP_ACCESS_TOKEN: 'wa-access',
  THEOCLAW_WHATSAPP_PHONE_NUMBER_ID: '1234',
  THEOCLAW_WHATSAPP_APP_SECRET: 'wa-app-secret',
  THEOCLAW_WHATSAPP_VERIFY_TOKEN: 'wa-verify',
}

/** A started WhatsApp stand-in: a FakeAdapter that also converts envelopes, counting each call. */
class ConvertingWhatsApp extends FakeAdapter {
  conversions = 0

  constructor() {
    super('whatsapp')
  }

  toDeliverableEvents(): WhatsAppMessageEvent[] {
    this.conversions += 1
    return []
  }
}

describe('composeTheoClaw with WhatsApp', () => {
  it('serves the WhatsApp route through the started adapter', async () => {
    const whatsapp = new ConvertingWhatsApp()
    const { builders } = fakeBuilders({ whatsapp })
    const { loop, router } = composeTheoClaw({ env: WHATSAPP_ENV, agentFactory: noAgent, builders, write: () => undefined })
    await loop.ready
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
    const signature = `sha256=${createHmac('sha256', 'wa-app-secret').update(body).digest('hex')}`

    const response = await router(
      new Request('http://localhost/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'x-hub-signature-256': signature },
        body,
      }),
    )

    expect(response.status).toBe(200)
    expect(whatsapp.conversions).toBe(1)
    await loop.stopAll()
  })

  it('a chunked oversized whatsapp post never reaches the route', async () => {
    const whatsapp = new ConvertingWhatsApp()
    const { builders } = fakeBuilders({ whatsapp })
    const { loop, router } = composeTheoClaw({ env: WHATSAPP_ENV, agentFactory: noAgent, builders, write: () => undefined })
    await loop.ready

    const response = await router(chunkedPost('/webhooks/whatsapp', MAX_BODY_BYTES + 1))

    expect(response.status).toBe(413)
    expect(whatsapp.conversions).toBe(0)
    await loop.stopAll()
  })
})

const TEAMS_ENV = {
  THEOCLAW_TEAMS_CLIENT_ID: 'teams-client-id',
  THEOCLAW_TEAMS_CLIENT_SECRET: 'teams-client-secret',
  THEOCLAW_TEAMS_TENANT_ID: '00000000-0000-4000-8000-000000000000',
}

/** A verifier factory that counts how often it builds and how often its verifier runs. */
function countingVerifierFactory() {
  const counts = { built: 0, verified: 0 }
  const factory = (): TeamsVerifier => {
    counts.built += 1
    return async () => {
      counts.verified += 1
      return {
        ok: true,
        activity: { type: 'conversationUpdate' },
        token: { appId: 'teams-client-id', serviceUrl: 'https://smba.trafficmanager.net/teams/' },
      }
    }
  }
  return { factory, counts }
}

describe('composeTheoClaw with Teams', () => {
  it('builds the teams verifier once for many requests', async () => {
    const { factory, counts } = countingVerifierFactory()
    const { builders } = fakeBuilders()
    const { loop, router } = composeTheoClaw({
      env: TEAMS_ENV,
      agentFactory: noAgent,
      builders,
      write: () => undefined,
      teamsVerifierFactory: factory,
    })
    await loop.ready

    for (const _ of [1, 2]) {
      const response = await router(new Request('http://localhost/webhooks/teams', { method: 'POST', body: '{}' }))
      expect(response.status).toBe(200)
    }

    expect(counts).toEqual({ built: 1, verified: 2 })
    await loop.stopAll()
  })

  it('a chunked oversized teams post never reaches the verifier', async () => {
    const { factory, counts } = countingVerifierFactory()
    const { builders } = fakeBuilders()
    const { loop, router } = composeTheoClaw({
      env: TEAMS_ENV,
      agentFactory: noAgent,
      builders,
      write: () => undefined,
      teamsVerifierFactory: factory,
    })
    await loop.ready

    const response = await router(chunkedPost('/webhooks/teams', MAX_BODY_BYTES + 1))

    expect(response.status).toBe(413)
    expect(counts.verified).toBe(0)
    await loop.stopAll()
  })

  it('a verifier that cannot be built leaves the teams route at 503 and the rest running', async () => {
    const { builders } = fakeBuilders()
    const lines: string[] = []
    const { loop, router } = composeTheoClaw({
      env: { ...TEAMS_ENV, ...TELEGRAM_AND_LINE },
      agentFactory: noAgent,
      builders,
      write: (line) => lines.push(line),
      teamsVerifierFactory: () => {
        throw new TypeError('teamsActivityVerifier: tenantId must be a tenant GUID')
      },
    })
    await loop.ready

    const response = await router(new Request('http://localhost/webhooks/teams', { method: 'POST', body: '{}' }))

    expect(response.status).toBe(503)
    expect(lines).toContain('teams: the activity verifier could not be built: teamsActivityVerifier: tenantId must be a tenant GUID')
    expect((await router(signedLinePost())).status).toBe(200)
    await loop.stopAll()
  })

  it('writes a verifier failure without the configured value it quotes', async () => {
    const { builders } = fakeBuilders()
    const lines: string[] = []
    const { loop } = composeTheoClaw({
      env: { ...TEAMS_ENV, THEOCLAW_TEAMS_TENANT_ID: 'not-a-guid-tenant' },
      agentFactory: noAgent,
      builders,
      write: (line) => lines.push(line),
    })
    await loop.ready

    expect(lines.some((line) => line.startsWith('teams: the activity verifier could not be built'))).toBe(true)
    expect(lines.join('\n')).not.toContain('not-a-guid-tenant')
    await loop.stopAll()
  })
})
