/**
 * An ACP agent answers `session/prompt` with only a `stopReason`; the reply text arrives before
 * that as `session/update` notifications carrying `agent_message_chunk` content, for the session
 * `session/new` returned. These tests drive `createACPTool` against a scripted ACP agent that
 * speaks that shape, and refuses a prompt that names no session or carries no content blocks, so
 * a tool that skips the handshake or reads the text from the prompt result fails here.
 */
import path from 'node:path'

import type { AcpTransport } from '../../packages/agents/src/acp/client.js'
import { AcpMessageDecoder, encodeAcpMessage } from '../../packages/agents/src/acp/protocol.js'
import { describe, expect, it, vi } from 'vitest'

import { createACPTool } from '../../packages/theo/src/server/agent/acp-tool.js'

type Message = Record<string, unknown>

interface AgentScript {
  /** `session/update` params to emit before the prompt result; `echo:<text>` when absent. */
  updates?: (sessionId: string, text: string) => unknown[]
  /** Result of `session/new`. */
  sessionNewResult?: unknown
  /** `session/request_permission` params to send, one at a time, before the updates. */
  permissionRequests?: unknown[]
}

function chunk(sessionId: string, text: string): unknown {
  return {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  }
}

/** A scripted ACP agent: answers the handshake, streams updates, then the prompt result. */
function scriptedAgent(script: AgentScript = {}) {
  const sent: string[] = []
  const sentParams: Record<string, unknown> = {}
  const replies: Message[] = []
  const dec = new AcpMessageDecoder()
  let sink: ((chunk: string) => void) | undefined
  let pendingPermissions: unknown[] = []
  let promptTurn: { id: unknown; sessionId: string; text: string } | undefined

  const emit = (message: unknown): void => {
    setTimeout(() => sink?.(encodeAcpMessage({ jsonrpc: '2.0', ...(message as Message) })), 0)
  }
  const finishTurn = (): void => {
    if (!promptTurn) return
    const { id, sessionId, text } = promptTurn
    const updates = script.updates?.(sessionId, text) ?? [chunk(sessionId, `echo:${text}`)]
    for (const params of updates) emit({ method: 'session/update', params })
    emit({ id, result: { stopReason: 'end_turn' } })
  }
  const nextPermissionOrFinish = (): void => {
    const next = pendingPermissions.shift()
    if (next === undefined) finishTurn()
    else emit({ id: 1000 + replies.length, method: 'session/request_permission', params: next })
  }
  const onPrompt = (id: unknown, params: { sessionId?: unknown; prompt?: unknown }): void => {
    if (typeof params.sessionId !== 'string' || !Array.isArray(params.prompt)) {
      emit({ id, error: { code: -32602, message: 'invalid params' } })
      return
    }
    const blocks = params.prompt as { type?: unknown; text?: unknown }[]
    const text = blocks.map((b) => (b.type === 'text' ? String(b.text) : '')).join('')
    promptTurn = { id, sessionId: params.sessionId, text }
    pendingPermissions = [...(script.permissionRequests ?? [])]
    nextPermissionOrFinish()
  }
  const onRequest = (msg: Message): void => {
    const method = String(msg.method)
    sent.push(method)
    sentParams[method] = msg.params
    if (method === 'initialize') emit({ id: msg.id, result: { protocolVersion: 1 } })
    else if (method === 'session/new')
      emit({ id: msg.id, result: script.sessionNewResult ?? { sessionId: 's1' } })
    else if (method === 'session/prompt') onPrompt(msg.id, (msg.params ?? {}) as never)
    else emit({ id: msg.id, error: { code: -32601, message: `method not found: ${method}` } })
  }

  const transport: AcpTransport = {
    send: (line) => {
      for (const m of dec.push(line)) {
        const msg = m as Message
        if (typeof msg.method === 'string') onRequest(msg)
        else {
          replies.push(msg)
          nextPermissionOrFinish()
        }
      }
    },
    subscribe: (cb) => {
      sink = cb
    },
  }
  return { transport, sent, sentParams, replies }
}

function toolFor(
  transport: () => AcpTransport,
  extra: { cwd?: string; onPermissionRequest?: () => { granted: boolean } } = {},
) {
  return createACPTool({
    command: 'noop',
    name: 'code_agent',
    description: 'A coding agent',
    cwd: extra.cwd,
    onPermissionRequest: extra.onPermissionRequest ?? (() => ({ granted: false })),
    transportFactory: transport,
  })
}

const HANDSHAKE = ['initialize', 'session/new', 'session/prompt']

function permissionParams(options: unknown): unknown {
  return {
    sessionId: 's1',
    toolCall: { toolCallId: 't1', title: 'rm', kind: 'delete', status: 'pending' },
    options,
  }
}

describe('createACPTool collects the reply from session updates', () => {
  it('test_initialize_carries_protocol_version_1', async () => {
    const agent = scriptedAgent()
    const output = await toolFor(() => agent.transport).handler({ message: 'hi' })

    expect(agent.sent).toEqual(HANDSHAKE)
    expect(agent.sentParams.initialize).toEqual({ protocolVersion: 1, clientCapabilities: {} })
    expect(agent.sentParams['session/prompt']).toEqual({
      sessionId: 's1',
      prompt: [{ type: 'text', text: 'hi' }],
    })
    expect(output).toBe('echo:hi')
  })

  it('test_the_reply_is_the_text_chunks_in_arrival_order', async () => {
    const agent = scriptedAgent({ updates: (s) => [chunk(s, 'ab'), chunk(s, 'cd')] })
    const output = await toolFor(() => agent.transport).handler({ message: 'hi' })

    expect(output).toBe('abcd')
  })

  it('test_a_chunk_for_another_session_is_left_out', async () => {
    const agent = scriptedAgent({ updates: (s) => [chunk('other', 'x'), chunk(s, 'y')] })
    const output = await toolFor(() => agent.transport).handler({ message: 'hi' })

    expect(output).toBe('y')
  })

  it('test_session_new_receives_an_absolute_cwd', async () => {
    const relative = scriptedAgent()
    await toolFor(() => relative.transport, { cwd: 'sub' }).handler({ message: 'hi' })
    const absent = scriptedAgent()
    await toolFor(() => absent.transport).handler({ message: 'hi' })

    expect(relative.sentParams['session/new']).toEqual({
      cwd: path.resolve('sub'),
      mcpServers: [],
    })
    expect(absent.sentParams['session/new']).toEqual({ cwd: process.cwd(), mcpServers: [] })
  })

  it('test_a_non_text_or_malformed_update_is_ignored', async () => {
    const agent = scriptedAgent({
      updates: (s) => [
        { sessionId: s, update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'ls' } },
        { sessionId: s },
        null,
        { sessionId: s, update: { sessionUpdate: 'agent_message_chunk', content: null } },
        {
          sessionId: s,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'image' } },
        },
        chunk(s, 'ok'),
      ],
    })
    const output = await toolFor(() => agent.transport).handler({ message: 'hi' })

    expect(agent.sent).toEqual(HANDSHAKE)
    expect(output).toBe('ok')
  })

  it('test_a_granted_permission_selects_the_allow_once_option', async () => {
    const agent = scriptedAgent({
      permissionRequests: [
        permissionParams([
          { optionId: 'opt-r', name: 'Deny', kind: 'reject_once' },
          { optionId: 'opt-a', name: 'Allow', kind: 'allow_once' },
        ]),
      ],
    })
    const output = await toolFor(() => agent.transport, {
      onPermissionRequest: () => ({ granted: true }),
    }).handler({ message: 'hi' })

    expect(agent.replies).toHaveLength(1)
    expect(agent.replies[0].error).toBeUndefined()
    expect(agent.replies[0].result).toEqual({ outcome: { outcome: 'selected', optionId: 'opt-a' } })
    expect(output).toBe('echo:hi')
  })

  it('test_a_permission_with_no_matching_option_is_cancelled', async () => {
    const agent = scriptedAgent({
      permissionRequests: [
        permissionParams([{ optionId: 'always', name: 'Always', kind: 'allow_always' }]),
        permissionParams('not an array'),
      ],
    })
    const output = await toolFor(() => agent.transport, {
      onPermissionRequest: () => ({ granted: true }),
    }).handler({ message: 'hi' })

    expect(agent.replies.map((r) => r.result)).toEqual([
      { outcome: { outcome: 'cancelled' } },
      { outcome: { outcome: 'cancelled' } },
    ])
    expect(agent.replies.every((r) => r.error === undefined)).toBe(true)
    expect(output).toBe('echo:hi')
  })

  it('test_a_denied_permission_falls_back_to_reject_always', async () => {
    const agent = scriptedAgent({
      permissionRequests: [
        permissionParams([
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'never', name: 'Never', kind: 'reject_always' },
        ]),
      ],
    })
    const onPermissionRequest = vi.fn(() => ({ granted: false }))
    const output = await toolFor(() => agent.transport, { onPermissionRequest }).handler({
      message: 'hi',
    })

    expect(onPermissionRequest).toHaveBeenCalledTimes(1)
    expect(agent.replies[0].result).toEqual({ outcome: { outcome: 'selected', optionId: 'never' } })
    expect(output).toBe('echo:hi')
  })

  it('test_two_concurrent_calls_keep_their_replies_apart', async () => {
    const agents = [scriptedAgent(), scriptedAgent()]
    let next = 0
    const tool = toolFor(() => agents[next++].transport)

    const outputs = await Promise.all([
      tool.handler({ message: 'a' }),
      tool.handler({ message: 'b' }),
    ])

    expect(agents.map((a) => a.sent)).toEqual([HANDSHAKE, HANDSHAKE])
    expect(outputs).toEqual(['echo:a', 'echo:b'])
  })
})
