import { describe, expect, it } from 'vitest'

import { AgentBuilder } from '../../packages/agents/src/index.js'
import { makeThreadStartRun } from '../../packages/theo/src/server/agent/build-agent-streamer.js'

/**
 * theokit#328 — the thread follow-up route resolves the credential before it knows the model.
 *
 * theokit#327 fixed this on the agent endpoint: `mountAgent` now accepts an `ApiKeyResolver` and
 * calls it with the compiled model, so an agent declaring `anthropic/…` gets the Anthropic key
 * instead of whatever env priority picked first.
 *
 * The thread path was never covered. `serve-aux-routes.ts:170` calls `deps.resolveApiKey()` and
 * hands the result to `handleThreadMessage`, which passes it here — and `makeThreadStartRun`
 * compiles the module INSIDE the generator, so the model is knowable at exactly the point the key
 * is used, and nobody crosses the two.
 *
 * A consumer taking `auth_failed (HTTP 401)` on a thread follow-up after #327 shipped is hitting
 * this, not a failed fix. What proves `mountAgent` proves nothing about this function.
 */
function agentModule(model: string): unknown {
  return { default: AgentBuilder.create().model(model).system('probe').build() }
}

describe('the thread path resolves the key from the agent it is about to run (theokit#328)', () => {
  it('passes the declared model to the resolver', async () => {
    const seen: (string | undefined)[] = []

    const startRun = makeThreadStartRun(
      agentModule('anthropic/claude-sonnet-4-6'),
      (model) => {
        seen.push(model)
        return 'sk-test'
      },
      'agent "probe"',
      'probe',
      // `request` became required so the omission that made a thread run open a
      // trace of its own (usetheokit/theokit#381) stops being expressible. This
      // test is about provider routing, so any request will do — but it has to be
      // a real one, because the trace is read off its headers.
      new Request('http://localhost/api/agents/probe/threads/t1/messages'),
    )

    // Draining the stream is what forces the generator body — and the compile — to run. The run
    // itself fails without a provider; the resolver call happens before that and is what is under
    // test.
    const iterator = startRun('session-1', 'hi')[Symbol.asyncIterator]()
    try {
      await iterator.next()
    } catch {
      /* the model call is not what this test asserts */
    }

    expect(seen).toEqual(['anthropic/claude-sonnet-4-6'])
  })

  it('still accepts a plain key, so existing callers keep working', () => {
    expect(() =>
      makeThreadStartRun(
        agentModule('gpt-4o-mini'),
        'sk-test',
        'agent "probe"',
        'probe',
        new Request('http://localhost/api/agents/probe/threads/t1/messages'),
      ),
    ).not.toThrow()
  })
})
