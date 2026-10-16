/**
 * B-414 — a theokit agent can be served over ACP.
 *
 * An editor reaches a theokit agent through `@theokit/acp`: `toAgentFactory` hands the server one
 * agent per session, and the editor speaks JSON-RPC over the server's stdin and stdout. Nothing
 * proved the two halves fit. This file serves an agent in process with the PUBLISHED server, on two
 * in-memory streams, and drives it with this package's own `AcpClient`, the way an editor would:
 * `initialize`, `session/new`, `session/prompt`.
 *
 * The SDK runs in fixture mode (a `theo_test_` key, no base URL), so no provider key is needed and
 * the reply is deterministic: `Return only: BANANA` answers `BANANA`.
 *
 * Two defects stood between a served theokit agent and an editor, and each case below pins one:
 *   - a guarded turn had `wait` only, and the server reads `run.stream()`, so a guarded agent sent
 *     the editor nothing;
 *   - both wrappers rebuilt the handle without `pluginManager`, which the server's default `ask`
 *     mode needs to install its permission plugin, so a wrapped agent failed closed.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { serveAcp } from '@theokit/acp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AcpClient } from '../../src/acp/client.js'
import type { AcpTransport } from '../../src/acp/client.js'
import { defineAgent } from '../../src/bridge/define-agent.js'
import { toAgentFactory } from '../../src/bridge/sdk-adapter.js'
import type { Guardrail } from '../../src/guardrails/index.js'

type ServeOptions = Parameters<typeof serveAcp>[0]

const PROMPT = 'Return only: BANANA'

const redactBanana: Guardrail = {
  name: 'redact-banana',
  checkOutput: (text) => ({ action: 'redact', text: text.replaceAll('BANANA', '[REDACTED]') }),
}

interface SessionUpdate {
  update?: { sessionUpdate?: string; content?: { type?: string; text?: string } }
}

interface ServedEditor {
  client: AcpClient
  /** The text of every `agent_message_chunk` the server sent, in order. */
  agentText: () => string
  serverLog: string[]
}

let workDir: string
let clientToServer: PassThrough | undefined
let serving: Promise<void> | undefined

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'theokit-acp-'))
  clientToServer = undefined
  // Fixture mode is refused whenever a base URL is configured; the test must not inherit one.
  vi.stubEnv('THEOKIT_API_BASE_URL', undefined)
})

afterEach(async () => {
  // Ending the server's stdin is how an editor hangs up; serveAcp resolves once it has disposed
  // every session, so the next test does not meet this one's agent.
  clientToServer?.end()
  await serving
  serving = undefined
  vi.unstubAllEnvs()
  rmSync(workDir, { recursive: true, force: true })
})

/** Serve `guardrails`/`maxIterations` over ACP and connect an editor-side client to it. */
function serveAgent(
  agent: { guardrails?: readonly Guardrail[]; maxIterations?: number },
  permissionDefault?: ServeOptions['permissionDefault'],
): ServedEditor {
  const factory = toAgentFactory(defineAgent({ model: 'openai/gpt-4o-mini', ...agent }), {
    apiKey: 'theo_test_acp_served_agent',
    approvals: { kind: 'owned-by-surface', reason: 'the ACP server asks the editor itself' },
    overrides: { cwd: workDir },
  })
  const toServer = new PassThrough()
  clientToServer = toServer
  const serverToClient = new PassThrough()
  const serverLog: string[] = []
  serving = serveAcp({
    // toAgentFactory types its agent structurally (SdkAgentHandle), not as the SDK's SDKAgent, so the
    // server's parameter needs the cast; what the server calls on it is what this file asserts.
    agent: factory as unknown as ServeOptions['agent'],
    stdin: toServer,
    stdout: serverToClient,
    log: (line) => serverLog.push(line),
    ...(permissionDefault === undefined ? {} : { permissionDefault }),
  })

  const transport: AcpTransport = {
    send: (line) => toServer.write(line),
    subscribe: (onData) => serverToClient.on('data', (chunk: Buffer) => onData(String(chunk))),
  }
  const client = new AcpClient(transport)
  const chunks: string[] = []
  client.onNotification('session/update', (params) => {
    const { update } = params as SessionUpdate
    if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      chunks.push(update.content.text ?? '')
    }
  })
  // The fixture run calls no tool; an editor that allows keeps the case independent of that.
  client.onRequest('session/request_permission', () => ({
    outcome: { outcome: 'selected', optionId: 'allow_once' },
  }))
  return { client, agentText: () => chunks.join(''), serverLog }
}

/** `initialize`, `session/new` and one `session/prompt`, as an editor sends them. */
async function promptOnce(editor: ServedEditor): Promise<{
  protocolVersion: unknown
  sessionId: unknown
  stopReason: unknown
}> {
  const init = (await editor.client.request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
  })) as { protocolVersion?: unknown }
  const session = (await editor.client.request('session/new', {
    cwd: workDir,
    mcpServers: [],
  })) as { sessionId?: unknown }
  const answer = (await editor.client.request('session/prompt', {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: PROMPT }],
  })) as { stopReason?: unknown }
  return {
    protocolVersion: init.protocolVersion,
    sessionId: session.sessionId,
    stopReason: answer.stopReason,
  }
}

describe('a theokit agent served over ACP', () => {
  it('test_an_editor_completes_initialize_session_new_and_session_prompt', async () => {
    const editor = serveAgent({}, 'auto')

    const turn = await promptOnce(editor)

    expect(turn.protocolVersion).toBeTypeOf('number')
    expect(turn.sessionId).toBeTypeOf('string')
    expect(turn.stopReason).toBe('end_turn')
    expect(editor.agentText(), editor.serverLog.join('\n')).toContain('BANANA')
  })

  it('test_a_guarded_agent_streams_the_guarded_text_to_the_editor', async () => {
    const editor = serveAgent({ guardrails: [redactBanana] }, 'auto')

    const turn = await promptOnce(editor)

    expect(turn.stopReason).toBe('end_turn')
    expect(editor.agentText(), editor.serverLog.join('\n')).toContain('[REDACTED]')
    expect(editor.agentText()).not.toContain('BANANA')
  })

  it('test_the_default_permission_mode_serves_an_agent_with_guardrails_and_a_step_ceiling', async () => {
    const editor = serveAgent({ guardrails: [redactBanana], maxIterations: 4 })

    const turn = await promptOnce(editor)

    expect(turn.stopReason, editor.serverLog.join('\n')).toBe('end_turn')
  })
})
