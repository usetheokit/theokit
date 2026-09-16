/**
 * #101 — the reviewer routes its model to the credential that will serve it.
 *
 * `theocode review` failed for every OAuth user, which is the default sign-in:
 *
 *   ERROR: API key for provider "openai" expected to start with "sk-".
 *
 * The chat path routes — `run.ts` and `chat-transport.ts` both call `routeToCredential` before
 * building — and the review path did not. So `openai/gpt-5.6-terra` reached a provider that wants
 * an `sk-` key, while the same model on the same credential worked fine through `exec` and
 * `resume`. One credential, two answers, decided by which command asked.
 *
 * The arms assert the MODEL the agent is created with, through the `createInstance` seam B-061
 * added for exactly this — "the seam that makes a role's composition assertable without a
 * credential". Asserting that no error is thrown would be a weaker claim about a different thing.
 */
import { describe, expect, it } from 'vitest'

import { createReviewAgent } from '../../src/review/create-agent.js'
import type { CreationOptions } from '../../src/review/create-agent.js'

const config = {
  model: 'openai/gpt-5.6-terra',
  reasoning_effort: 'medium' as const,
  sandbox_mode: 'read-only' as const,
}

const capture = async (
  cred: { kind: string; provider: string },
): Promise<string | undefined> => {
  let seen: CreationOptions | undefined
  const factory = createReviewAgent({
    config: config as never,
    cwd: '/p',
    credential: async () => ({ apiKey: 'tok', ...cred }) as never,
    registerCleanup: () => {},
    createInstance: async (opts) => {
      seen = opts
      return { send: async () => ({}), delete: async () => {} } as never
    },
  })
  await factory({ agentId: 'a', systemPrompt: 's' })
  const m = seen?.model
  return typeof m === 'string' ? m : (m as { id?: string } | undefined)?.id
}

describe('#101 — review honours the credential kind', () => {
  it('test_a_chatgpt_credential_routes_the_model', async () => {
    // The defect. Without routing this stayed `openai/…` and the provider refused the OAuth token.
    expect(await capture({ kind: 'oauth', provider: 'openai' })).toContain('chatgpt')
  })

  it('test_an_api_key_credential_leaves_the_model_alone', async () => {
    // Negative control, and the arm that would catch an over-eager fix: routing unconditionally
    // would send a real `sk-` user to a provider they did not configure.
    expect(await capture({ kind: 'apiKey', provider: 'openai' })).toBe('openai/gpt-5.6-terra')
  })
})
