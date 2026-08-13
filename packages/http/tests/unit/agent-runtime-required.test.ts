import { describe, expect, it } from 'vitest'

import { TheoApp } from '../../src/app.js'
import { HttpDecoratorsConfigError } from '../../src/bridge/errors.js'

/**
 * Configuring an app to serve agents without giving it an agent runtime must fail loudly.
 *
 * ## Why this is a negative case and not an edge case
 *
 * Per `testing.md` § 4.1: an edge case asks "does it hold at the boundary?", a negative case asks
 * "does it fail fast, clear, and typed?". This is the second. `agents: [...]` with no
 * `agentRuntime` is not an extreme of a valid configuration — it is an invalid one, and the only
 * acceptable behaviour is a refusal that names the fix.
 *
 * The alternative is worse than a crash: mounting zero agent routes and reporting a successful
 * boot. The app would answer 404 for every agent request and nothing would say why — the silent
 * failure `error-handling.md` § 2 exists to forbid.
 *
 * Before the inversion (B-M67-21) this branch resolved the runtime with a dynamic
 * `import('@theokit/agents')` inside a `try`/`catch`, so a missing agent layer surfaced as an
 * install instruction. The dependency now arrives as an argument, so the message names the
 * argument.
 */

const ENTRY = {
  name: 'assistant',
  route: '/api/agents/assistant',
  compiled: { model: 'anthropic/claude-sonnet-5', tools: [], agents: {}, stream: true },
}

describe('TheoApp.create — agents without an agent runtime', () => {
  it('test_refuses_with_a_TYPED_error_not_a_bare_Error', async () => {
    // The type is the contract: a caller catching `HttpDecoratorsConfigError` distinguishes "you
    // configured this wrong" from any runtime failure that happens to be an `Error`.
    await expect(TheoApp.create({ controllers: [], agents: [ENTRY] })).rejects.toBeInstanceOf(
      HttpDecoratorsConfigError,
    )
  })

  it('test_the_message_names_the_missing_option_and_how_to_supply_it', async () => {
    // A refusal that does not say what to do sends the reader into the source. Asserting on the
    // message content is asserting on the thing the operator actually receives.
    await expect(TheoApp.create({ controllers: [], agents: [ENTRY] })).rejects.toThrow(
      /agentRuntime/,
    )
    await expect(TheoApp.create({ controllers: [], agents: [ENTRY] })).rejects.toThrow(
      /generateAgentRoutes/,
    )
  })

  it('test_an_app_with_no_agents_still_boots_without_a_runtime', async () => {
    // Counter-proof, and the reason the option is optional rather than required: the overwhelming
    // majority of apps serve no agents at all, and forcing them to pass a runtime they never use
    // would be a tax paid by everyone to protect a branch none of them reach.
    const app = await TheoApp.create({ controllers: [] })
    expect(app).toBeInstanceOf(TheoApp)
  })

  it('test_an_EMPTY_agents_array_is_not_a_misconfiguration', async () => {
    // The boundary between the two cases above. `agents: []` says "I know about agents and have
    // none", which is valid; only a non-empty list needs something to build routes with.
    const app = await TheoApp.create({ controllers: [], agents: [] })
    expect(app).toBeInstanceOf(TheoApp)
  })
})
