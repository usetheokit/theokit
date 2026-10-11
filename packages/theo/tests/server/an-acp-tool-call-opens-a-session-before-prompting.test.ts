import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type AcpToolTransport,
  createACPTool,
  NodeAcpTransport,
} from '../../src/server/agent/acp-tool.js'

/**
 * B-408: one call of an ACP tool, against a spawned ACP agent process, must open a session
 * before it prompts. ACP requires "initialize", then "session/new", then "session/prompt"
 * naming the session it got back, and the agent's text arrives as "session/update"
 * notifications, not in the prompt response.
 *
 * The agent here is a real subprocess (`fixtures/handshake-enforcing-acp-agent.mjs`) that
 * refuses a prompt naming an unknown session, as the sibling `@theokit/acp` server does. The
 * scripted transport in `tests/unit/acp-tool.test.ts` answers any prompt unconditionally, which
 * is why it never saw the missing handshake.
 */
const AGENT = fileURLToPath(
  new URL('./fixtures/handshake-enforcing-acp-agent.mjs', import.meta.url),
)

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`no answer from the ACP agent within ${ms}ms`)), ms),
    ),
  ])
}

describe('an ACP tool call against a real agent process', () => {
  it('test_an_acp_tool_call_opens_a_session_before_prompting', async () => {
    const sent: string[] = []
    const transports: NodeAcpTransport[] = []
    const tool = createACPTool({
      command: process.execPath,
      args: [AGENT],
      name: 'code_agent',
      description: 'A coding agent',
      onPermissionRequest: () => ({ granted: false }),
      transportFactory: (config): AcpToolTransport => {
        const real = new NodeAcpTransport(config.command, config.args, config.cwd)
        transports.push(real)
        return {
          send: (line) => {
            for (const frame of line.split('\n').filter((l) => l.trim().length > 0)) {
              const parsed = JSON.parse(frame) as { method?: unknown }
              if (typeof parsed.method === 'string') sent.push(parsed.method)
            }
            real.send(line)
          },
          subscribe: (onData) => {
            real.subscribe(onData)
          },
          // Forwarded, so the tool releases the real process and hears it close on its own.
          close: () => real.close(),
          onClose: (listener) => {
            real.onClose(listener)
          },
        }
      },
    })

    let output: unknown
    let failure: unknown
    try {
      output = await withTimeout(Promise.resolve(tool.handler({ message: 'write a test' })), 10_000)
    } catch (err) {
      failure = err
    } finally {
      await Promise.all(transports.map((t) => t.close()))
    }

    expect(
      sent,
      `the tool sent ${JSON.stringify(sent)}; the call failed with: ${String(failure)}`,
    ).toEqual(['initialize', 'session/new', 'session/prompt'])
    expect(failure).toBeUndefined()
    expect(output).toBe('echo:write a test')
  })
})
