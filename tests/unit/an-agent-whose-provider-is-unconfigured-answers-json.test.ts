/**
 * An agent whose provider credential is missing answers with the JSON error envelope, on every host.
 *
 * Measured on 2026-10-02 against a `create-theokit@3.0.13` scaffold deployed to an AWS Lambda
 * Function URL with no `OPENROUTER_API_KEY`: `POST /api/agents/chat` answered
 * `502 Internal Server Error`, and the reason ("OPENROUTER_API_KEY is not set") existed only in
 * CloudWatch as an `Invoke Error`. The same scaffold under `theokit start` answered
 * `500 {"error":{"code":"INTERNAL","message":"... OPENROUTER_API_KEY is not set ..."}}`.
 *
 * The throw came from the key resolver `mountAgent` calls, and the generated deploy entries call
 * `mountAgent` with nothing around it. The Node server catches it one layer up; Lambda, Vercel and
 * Netlify had no such layer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentBuilder } from '../../packages/agents/src/index.js'
import { mountAgent } from '../../packages/theo/src/server/agent/mount-agent.js'

function agentModule(): unknown {
  return {
    default: AgentBuilder.create().model('openrouter/openai/gpt-4o-mini').system('probe').build(),
  }
}

function post(): Request {
  return new Request('http://localhost/api/agents/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Theo-Action': '1' },
    body: JSON.stringify({ message: 'hi' }),
  })
}

const missingKey = (): string => {
  throw new Error(
    'Model "openrouter/openai/gpt-4o-mini" declares provider "openrouter", but OPENROUTER_API_KEY is not set.',
  )
}

describe('mountAgent with a key resolver that throws', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('answers 500 with the INTERNAL envelope instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await mountAgent(agentModule(), post(), missingKey, { agentName: 'chat' })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: {
        code: 'INTERNAL',
        message:
          'Model "openrouter/openai/gpt-4o-mini" declares provider "openrouter", but OPENROUTER_API_KEY is not set.',
      },
    })
  })

  it('logs the failure with the agent name, so the operator sees it beside the response', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await mountAgent(agentModule(), post(), missingKey, { agentName: 'chat' })

    expect(String(error.mock.calls[0]?.[0])).toContain('agent "chat"')
  })
})
