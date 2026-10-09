import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  AcpTurnStoppedError,
  createACPTool,
  NodeAcpTransport,
} from '../../src/server/agent/acp-tool.js'

/**
 * loop-code-review LCR0103 (#84): a real agent process that ends its turn with `max_tokens`
 * (fixture flag `--stop-reason`) streams part of a reply and then stops. The call must reject with
 * the reason and the partial text, not return the partial text as the agent's finished answer.
 */
const AGENT = fileURLToPath(
  new URL('./fixtures/handshake-enforcing-acp-agent.mjs', import.meta.url),
)

describe('an ACP tool call against an agent that stops its turn early', () => {
  it('test_a_spawned_agent_that_stops_on_max_tokens_rejects_the_call_typed', async () => {
    const transports: NodeAcpTransport[] = []
    const tool = createACPTool({
      command: process.execPath,
      args: [AGENT, '--stop-reason=max_tokens'],
      name: 'code_agent',
      description: 'A coding agent',
      onPermissionRequest: () => ({ granted: false }),
      timeoutMs: 10_000,
      transportFactory: (config) => {
        const real = new NodeAcpTransport(config.command, config.args, config.cwd)
        transports.push(real)
        return real
      },
    })

    let failure: unknown
    try {
      await tool.handler({ message: 'write a test' })
    } catch (err) {
      failure = err
    } finally {
      await Promise.all(transports.map((t) => t.close()))
    }

    expect(failure).toBeInstanceOf(AcpTurnStoppedError)
    expect(failure).toMatchObject({ stopReason: 'max_tokens', partialText: 'echo:write a test' })
  })
})
