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

/** A fake transport that auto-answers session/prompt and forwards permission requests. */
function scriptedTransport(onSend?: (msg: Record<string, unknown>) => void): AcpTransport {
  const dec = new AcpMessageDecoder()
  let sink: ((chunk: string) => void) | undefined
  return {
    send: (line) => {
      for (const m of dec.push(line)) {
        const msg = m as Record<string, unknown>
        onSend?.(msg)
        if (msg.method === 'session/prompt') {
          const p = msg.params as { message: string }
          sink?.(encodeAcpMessage({ jsonrpc: '2.0', id: msg.id, result: { text: `echo:${p.message}` } }))
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
      createACPTool({ command: 'noop', name: 'x', description: 'd', transportFactory: () => scriptedTransport() }),
    ).toThrow(/onPermissionRequest/)
  })

  it('routes a permission request from the agent to onPermissionRequest', async () => {
    const onPermissionRequest = vi.fn(() => ({ granted: false }))
    let sink: ((chunk: string) => void) | undefined
    const transport: AcpTransport = {
      send: () => {},
      subscribe: (cb) => {
      sink = cb
    },
    }
    const tool = createACPTool({
      command: 'noop',
      name: 'code_agent',
      description: 'd',
      onPermissionRequest,
      transportFactory: () => transport,
    })
    // Trigger a handler run so the client is wired, then simulate an agent permission request.
    Promise.resolve(tool.handler({ message: 'hi' })).catch(() => {})
    await Promise.resolve()
    sink?.(encodeAcpMessage({ jsonrpc: '2.0', id: 7, method: 'session/request_permission', params: { tool: 'rm' } }))
    await Promise.resolve()
    await Promise.resolve()
    expect(onPermissionRequest).toHaveBeenCalledWith({ tool: 'rm' })
  })
})

describe('NodeAcpTransport (real subprocess smoke)', () => {
  it('round-trips a JSON-RPC message through a node echo agent', async () => {
    const echo = [
      "process.stdin.on('data',b=>{",
      "for(const l of b.toString().split('\\n')){",
      "if(!l.trim())continue;const m=JSON.parse(l);",
      "if(m.method==='session/prompt')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{text:'ok:'+m.params.message}})+'\\n');",
      '}})',
    ].join('')
    const transport = new NodeAcpTransport('node', ['-e', echo])
    const received: string[] = []
    transport.subscribe((c) => {
      received.push(c)
    })
    transport.send(encodeAcpMessage({ jsonrpc: '2.0', id: 1, method: 'session/prompt', params: { message: 'hey' } }))
    await new Promise((r) => setTimeout(r, 300))
    transport.close()
    expect(received.join('')).toContain('ok:hey')
  })
})
