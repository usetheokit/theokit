/**
 * M17 (theokit-ai-first) — createACPTool: wrap a coding agent (Claude Code, Amp, Codex) as a tool.
 *
 * `createACPTool` spawns the agent via a transport (Node subprocess by default; injectable for
 * tests), drives it with `AcpClient`, and returns a `CustomTool`. `onPermissionRequest` is REQUIRED
 * (security by default — no default-allow). The real subprocess transport is smoke-tested against a
 * node echo agent.
 *
 * TDD RED-first.
 */
import type { AcpTransport } from '../../packages/agents/src/acp/client.js'
import { encodeAcpMessage, AcpMessageDecoder } from '../../packages/agents/src/acp/protocol.js'
import { describe, expect, it, vi } from 'vitest'

import { createACPTool, NodeAcpTransport } from '../../packages/theo/src/server/agent/acp-tool.js'

/** ACP v1 params of the permission request the scripted agent sends mid-prompt. */
const PERMISSION_PARAMS = {
  sessionId: 's1',
  toolCall: { toolCallId: 't1', title: 'rm', kind: 'delete', status: 'pending' },
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
  ],
}

/**
 * A fake ACP agent: answers `initialize` and `session/new`, and answers `session/prompt` the way
 * ACP does, with the text as a `session/update` `agent_message_chunk` and only `stopReason` in the
 * result. With `askPermission`, it first sends `session/request_permission` (id 7), records the
 * client's response in `permissionReplies`, and only then finishes the turn.
 */
function scriptedTransport(
  options: {
    onSend?: (msg: Record<string, unknown>) => void
    askPermission?: boolean
    permissionReplies?: Record<string, unknown>[]
  } = {},
): AcpTransport {
  const dec = new AcpMessageDecoder()
  let sink: ((chunk: string) => void) | undefined
  let finishTurn: (() => void) | undefined
  const reply = (message: Record<string, unknown>) =>
    sink?.(encodeAcpMessage({ jsonrpc: '2.0', ...message }))
  const onPrompt = (msg: Record<string, unknown>) => {
    const p = msg.params as { sessionId: string; prompt: { text: string }[] }
    finishTurn = () => {
      reply({
        method: 'session/update',
        params: {
          sessionId: p.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `echo:${p.prompt.map((b) => b.text).join('')}` },
          },
        },
      })
      reply({ id: msg.id, result: { stopReason: 'end_turn' } })
    }
    if (options.askPermission) {
      reply({ id: 7, method: 'session/request_permission', params: PERMISSION_PARAMS })
    } else {
      finishTurn()
    }
  }
  return {
    send: (line) => {
      for (const m of dec.push(line)) {
        const msg = m as Record<string, unknown>
        options.onSend?.(msg)
        if (msg.method === 'initialize') reply({ id: msg.id, result: { protocolVersion: 1 } })
        else if (msg.method === 'session/new') reply({ id: msg.id, result: { sessionId: 's1' } })
        else if (msg.method === 'session/prompt') onPrompt(msg)
        else if (msg.id === 7 && msg.method === undefined) {
          options.permissionReplies?.push(msg)
          finishTurn?.()
        }
      }
    },
    subscribe: (cb) => {
      sink = cb
    },
  }
}

describe('createACPTool', () => {
  it('returns a CustomTool that prompts the coding agent and returns its text', async () => {
    const tool = createACPTool({
      command: 'noop',
      name: 'code_agent',
      description: 'A coding agent',
      onPermissionRequest: () => ({ granted: true }),
      transportFactory: () => scriptedTransport(),
    })
    expect(tool.name).toBe('code_agent')
    const out = await tool.handler({ message: 'write a test' })
    expect(out).toBe('echo:write a test')
  })

  it('requires onPermissionRequest (security by default — no default-allow)', () => {
    expect(() =>
      // @ts-expect-error — omitting onPermissionRequest is a compile + runtime error
      createACPTool({
        command: 'noop',
        name: 'x',
        description: 'd',
        transportFactory: () => scriptedTransport(),
      }),
    ).toThrow(/onPermissionRequest/)
  })

  it('routes a permission request from the agent to onPermissionRequest', async () => {
    const onPermissionRequest = vi.fn(() => ({ granted: false }))
    const sent: unknown[] = []
    const permissionReplies: Record<string, unknown>[] = []
    const tool = createACPTool({
      command: 'noop',
      name: 'code_agent',
      description: 'd',
      onPermissionRequest,
      transportFactory: () =>
        scriptedTransport({
          askPermission: true,
          permissionReplies,
          onSend: (msg) => {
            if (typeof msg.method === 'string') sent.push(msg.method)
          },
        }),
    })

    const output = await tool.handler({ message: 'hi' })

    expect(onPermissionRequest).toHaveBeenCalledWith(PERMISSION_PARAMS)
    expect(permissionReplies).toHaveLength(1)
    expect(permissionReplies[0].error).toBeUndefined()
    expect(permissionReplies[0].result).toEqual({
      outcome: { outcome: 'selected', optionId: 'deny' },
    })
    expect(sent).toEqual(['initialize', 'session/new', 'session/prompt'])
    expect(output).toBe('echo:hi')
  })
})

describe('NodeAcpTransport (real subprocess smoke)', () => {
  it('round-trips a JSON-RPC message through a node echo agent', async () => {
    const echo = [
      "process.stdin.on('data',b=>{",
      "for(const l of b.toString().split('\\n')){",
      'if(!l.trim())continue;const m=JSON.parse(l);',
      "if(m.method==='session/prompt')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{text:'ok:'+m.params.message}})+'\\n');",
      '}})',
    ].join('')
    const transport = new NodeAcpTransport('node', ['-e', echo])
    const received: string[] = []
    transport.subscribe((c) => {
      received.push(c)
    })
    transport.send(
      encodeAcpMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/prompt',
        params: { message: 'hey' },
      }),
    )
    // Wait for the ANSWER, not for a clock. A fixed `setTimeout(300)` here was a real flake: it
    // passes 4/4 alone and failed inside the full run — 1072 files competing, and 300ms is not
    // enough for a spawned node process to boot, read stdin and write back. `rules/testing.md` § 6
    // names exactly this ("time in unit tests"), and the fix is not a longer sleep: a bigger number
    // is the same race with a lower failure rate. Polling for the condition makes the test fast on
    // an idle machine, reliable on a busy one, and failing only when the round-trip truly does not
    // happen.
    const deadline = Date.now() + 10_000
    while (!received.join('').includes('ok:hey') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10))
    }
    transport.close()
    expect(
      received.join(''),
      'the echo agent never answered within 10s — this is the round-trip failing, not the machine',
    ).toContain('ok:hey')
  })
})
