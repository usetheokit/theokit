import { fileURLToPath } from 'node:url'

import type { AcpTransport } from '@theokit/agents'
import { describe, expect, it } from 'vitest'

import {
  AcpTransportClosedError,
  createACPTool,
  NodeAcpTransport,
} from '../../src/server/agent/acp-tool.js'

/**
 * When the agent refuses one step of the ACP handshake, the tool call rejects with an error that
 * names the refused method, and sends nothing after it. The fixture agent is spawned with
 * `--refuse=<method>` and answers that method with `invalid params`, a message that does not name
 * the step, so these tests pass only when the tool adds the method itself.
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

/** Call the tool once against the fixture agent refusing `method`; record what it sent. */
async function callRefusing(method: string): Promise<{ sent: string[]; failure: unknown }> {
  const sent: string[] = []
  const transports: NodeAcpTransport[] = []
  const tool = createACPTool({
    command: process.execPath,
    args: [AGENT, `--refuse=${method}`],
    name: 'code_agent',
    description: 'A coding agent',
    onPermissionRequest: () => ({ granted: false }),
    transportFactory: (config): AcpTransport => {
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
      }
    },
  })
  let failure: unknown
  try {
    await withTimeout(Promise.resolve(tool.handler({ message: 'write a test' })), 10_000)
  } catch (err) {
    failure = err
  } finally {
    for (const t of transports) void t.close()
  }
  return { sent, failure }
}

function messageOf(failure: unknown): string {
  expect(failure).toBeInstanceOf(Error)
  // A refusal, not a protocol break: the message alone cannot tell them apart (review #80).
  expect(failure).not.toBeInstanceOf(AcpTransportClosedError)
  return (failure as Error).message
}

describe('an ACP tool call against an agent that refuses a step', () => {
  it('test_the_tool_rejects_naming_the_refused_method', async () => {
    const { sent, failure } = await callRefusing('session/new')

    expect(sent).toEqual(['initialize', 'session/new'])
    const message = messageOf(failure)
    expect(message).toMatch(/invalid params/)
    expect(message).toMatch(/session\/new/)
  })

  it('test_a_refused_initialize_sends_nothing_after_it', async () => {
    const { sent, failure } = await callRefusing('initialize')

    expect(sent).toEqual(['initialize'])
    expect(messageOf(failure)).toMatch(/refused initialize/)
  })

  it('test_a_refused_prompt_rejects_naming_session_prompt', async () => {
    const { sent, failure } = await callRefusing('session/prompt')

    expect(sent).toEqual(['initialize', 'session/new', 'session/prompt'])
    expect(messageOf(failure)).toMatch(/refused session\/prompt/)
  })
})
