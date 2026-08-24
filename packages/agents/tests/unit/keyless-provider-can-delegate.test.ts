/**
 * A local model must be able to delegate (usetheokit/theokit#423).
 *
 * `createDelegateTool` refused to construct when any target was a `SubAgentSpec` and
 * `defaults.apiKey` was empty — and an empty key is exactly what a keyless provider resolves to.
 * Both guards read "non-empty string" as the definition of authenticated, which was a safe reading
 * while every provider held a key and stopped being one when #407 made a keyless provider
 * reachable.
 *
 * The fix is deliberately NOT "accept `''`". An empty string is also what an unset environment
 * variable produces, so accepting it would turn a typo into an unauthenticated run. The keyless
 * case says so with a distinct value.
 */
import { describe, expect, it } from 'vitest'

import { createDelegateTool } from '../../src/tools/delegate-tool.js'

const ROSTER = [{ name: 'researcher', target: { model: 'ollama/llama3.2', system: 'research' } }]

describe('a keyless provider can delegate (#423)', () => {
  it('constructs when the caller declares the provider takes no credential', () => {
    expect(() =>
      createDelegateTool({ roster: ROSTER, defaults: { apiKey: null } } as never),
    ).not.toThrow()
  })

  it('still refuses a caller who said nothing', () => {
    // The guard's original value: a missing credential surfaces at startup rather than at the
    // model's first call.
    expect(() => createDelegateTool({ roster: ROSTER } as never)).toThrow(
      /requires defaults\.apiKey/u,
    )
  })

  it('still refuses an empty string, because that is what an unset env var looks like', () => {
    // The distinction the whole fix rests on. `''` is not a declaration; `null` is.
    expect(() => createDelegateTool({ roster: ROSTER, defaults: { apiKey: '' } } as never)).toThrow(
      /requires defaults\.apiKey/u,
    )
  })

  it('names the keyless option in the refusal, so the reader is not left guessing', () => {
    let message = ''
    try {
      createDelegateTool({ roster: ROSTER } as never)
    } catch (err) {
      message = (err as Error).message
    }

    expect(message).toContain('apiKey: null')
  })
})
