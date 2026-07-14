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

// Import from the workspace source (not the bare `@theokit/agents`) so the root `tsc`
// gate resolves it without the vitest alias; vitest resolves both to the same src file,
// so `AgentDefinitionError instanceof` still matches what `mountAgent` throws.
import { AgentDefinitionError } from '../../packages/agents/src/index.js'
import { defineAgent } from '../../packages/agents/src/bridge/define-agent.js'
import {
  mountAgent,
  parseAgentRequestBody,
} from '../../packages/theo/src/server/agent/mount-agent.js'

/** A CSRF-valid request (mirrors what the `useAgent` client sends: X-Theo-Action). */
function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/agents/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Theo-Action': '1' },
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
      { source: 'agents/echo.ts' },
    )
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { code: string } }
    expect(json.error.code).toBe('BAD_REQUEST')
  })

  it('test_fails_fast_on_non_agent_module', async () => {
    const err = await mountAgent(
      { default: { not: 'an agent' } },
      jsonRequest({ message: 'x' }),
      'k',
      { source: 'agents/bad.ts' },
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AgentDefinitionError)
    // Negative case asserts the SPECIFIC message (names the source file), not just "throws".
    expect((err as Error).message).toContain('agents/bad.ts')
  })

  it('test_rejects_cross_origin_post_without_csrf_header_in_strict_mode', async () => {
    // No X-Theo-Action header — a cross-origin POST that would spend LLM tokens.
    const request = new Request('http://localhost/api/agents/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    })
    const res = await mountAgent(
      { default: defineAgent({ model: 'm' }) },
      request,
      'k',
      { source: 'agents/echo.ts' },
    )
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: { code: string } }
    expect(json.error.code).toBe('CSRF_FAILED')
  })

  it('test_csrf_off_mode_allows_missing_header', async () => {
    const request = new Request('http://localhost/api/agents/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    // csrfMode 'off' skips the check → reaches body parsing → 400 (not 403).
    const res = await mountAgent(
      { default: defineAgent({ model: 'm' }) },
      request,
      'k',
      { source: 'agents/echo.ts', csrfMode: 'off' },
    )
    expect(res.status).toBe(400)
  })
})
