import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type AcpToolTransport,
  createACPTool,
  NodeAcpTransport,
} from '../../src/server/agent/acp-tool.js'

/**
 * The ACP tool against an agent this repository did not write.
 *
 * `an-acp-tool-call-opens-a-session-before-prompting.test.ts` drives
 * `fixtures/handshake-enforcing-acp-agent.mjs`, which we wrote, so a reading of the protocol that
 * the fixture and the tool share would pass there and still fail against a real agent. This test
 * spawns, unmodified, the example agent that the official ACP TypeScript SDK ships in its npm
 * package (`@agentclientprotocol/sdk`, pinned as a devDependency, file `dist/examples/agent.js`).
 * Its JSON-RPC framing, method routing and request validation are the SDK's: every request the
 * tool sends is parsed against the SDK's schema, and a malformed `initialize`, `session/new` or
 * `session/prompt` comes back as an error instead of a reply.
 *
 * Why not a production agent: the ACP agents published today (Claude Code, Gemini CLI, Codex
 * adapters) need a model account and the network, so they cannot run in the offline unit suite.
 * The SDK example needs neither: it plays a scripted turn with two tool calls and one
 * `session/request_permission` request, pausing about one second between steps.
 */
const SDK_ENTRY = fileURLToPath(import.meta.resolve('@agentclientprotocol/sdk'))
const EXAMPLE_AGENT = join(dirname(SDK_ENTRY), 'examples', 'agent.js')

const OPENING =
  "I'll help you with that. Let me start by reading some files to understand the current situation." +
  ' Now I understand the project structure. I need to make some changes to improve it.'

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`no answer from the ACP agent within ${ms}ms`)), ms),
    ),
  ])
}

/** One tool call against the SDK example agent, recording the methods each side sent. */
async function callExampleAgent(granted: boolean): Promise<{
  output: unknown
  failure: unknown
  sent: string[]
  received: string[]
}> {
  const sent: string[] = []
  const received: string[] = []
  const transports: NodeAcpTransport[] = []
  const methodsOf = (chunk: string): string[] =>
    chunk
      .split('\n')
      .filter((l) => l.trim().startsWith('{'))
      .map((l) => (JSON.parse(l) as { method?: unknown }).method)
      .filter((m): m is string => typeof m === 'string')
  const tool = createACPTool({
    command: process.execPath,
    args: [EXAMPLE_AGENT],
    name: 'code_agent',
    description: 'A coding agent',
    onPermissionRequest: () => ({ granted }),
    transportFactory: (config): AcpToolTransport => {
      const real = new NodeAcpTransport(config.command, config.args, config.cwd)
      transports.push(real)
      return {
        send: (line) => {
          sent.push(...methodsOf(line))
          real.send(line)
        },
        subscribe: (onData) => {
          real.subscribe((data) => {
            received.push(...methodsOf(data))
            onData(data)
          })
        },
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
    output = await withTimeout(
      Promise.resolve(tool.handler({ message: 'tidy the config' })),
      20_000,
    )
  } catch (err) {
    failure = err
  } finally {
    await Promise.all(transports.map((t) => t.close()))
  }
  return { output, failure, sent, received }
}

describe('an ACP tool call against the official ACP SDK example agent', () => {
  it('test_the_sdk_example_agent_is_present_in_the_pinned_package', () => {
    expect(existsSync(EXAMPLE_AGENT), `missing ${EXAMPLE_AGENT}`).toBe(true)
  })

  it('test_a_denied_permission_completes_the_turn_with_the_agents_text', async () => {
    const { output, failure, sent, received } = await callExampleAgent(false)

    expect(failure, `the call failed with: ${String(failure)}`).toBeUndefined()
    expect(sent).toEqual(['initialize', 'session/new', 'session/prompt'])
    expect(received).toContain('session/request_permission')
    expect(output).toBe(
      `${OPENING} I understand you prefer not to make that change. I'll skip the configuration update.`,
    )
  }, 30_000)

  it('test_a_granted_permission_completes_the_turn_with_the_agents_text', async () => {
    const { output, failure } = await callExampleAgent(true)

    expect(failure, `the call failed with: ${String(failure)}`).toBeUndefined()
    expect(output).toBe(
      `${OPENING} Perfect! I've successfully updated the configuration. The changes have been applied.`,
    )
  }, 30_000)
})
