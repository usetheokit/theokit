/**
 * M2 (theokit-ai-first) — mountAgent: the single dev+prod wiring point.
 *
 * `parseAgentRequestBody` accepts the ai-sdk `useChat` body (`{ id, messages }`, the typed
 * client path) AND the simple `{ message }` shape. `mountAgent` compiles the module (real,
 * pure), returns 400 on a bad body, and fails fast on a non-agent module — none of which
 * reach the SDK. The happy-path streaming (SDK → UIMessageStream) is proven deterministically
 * by the built-server E2E (`tests/integration/unified-agent-surface.test.ts`) with a stubbed
 * SDK, because `@theokit/agents` (and its dynamic `@theokit/sdk` import) is only resolvable
 * from inside `packages/theo/`, not from a root unit test.
 */
import { describe, expect, it } from 'vitest'

import { defineAgent, AgentDefinitionError } from '@theokit/agents'
import {
  mountAgent,
  parseAgentRequestBody,
} from '../../packages/theo/src/server/agent/mount-agent.js'

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/agents/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('parseAgentRequestBody (M2)', () => {
  it('test_extracts_last_user_text_from_ai_sdk_messages', () => {
    const parsed = parseAgentRequestBody({
      id: 'chat-1',
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'first' }] },
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'hel' },
            { type: 'text', text: 'lo' },
          ],
        },
      ],
    })
    expect(parsed).toEqual({ message: 'hello', sessionId: 'chat-1' })
  })

  it('test_accepts_simple_message_shape', () => {
    expect(parseAgentRequestBody({ message: 'hi', sessionId: 's9' })).toEqual({
      message: 'hi',
      sessionId: 's9',
    })
  })

  it('test_returns_null_on_empty_or_invalid_body', () => {
    expect(parseAgentRequestBody({})).toBeNull()
    expect(parseAgentRequestBody({ messages: [] })).toBeNull()
    expect(parseAgentRequestBody({ message: '' })).toBeNull()
    expect(parseAgentRequestBody(null)).toBeNull()
  })
})

describe('mountAgent (M2)', () => {
  it('test_returns_400_on_empty_body', async () => {
    const res = await mountAgent(
      { default: defineAgent({ model: 'm' }) },
      jsonRequest({}),
      'k',
      'agents/echo.ts',
    )
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { code: string } }
    expect(json.error.code).toBe('BAD_REQUEST')
  })

  it('test_fails_fast_on_non_agent_module', async () => {
    await expect(
      mountAgent(
        { default: { not: 'an agent' } },
        jsonRequest({ message: 'x' }),
        'k',
        'agents/bad.ts',
      ),
    ).rejects.toBeInstanceOf(AgentDefinitionError)
  })
})
