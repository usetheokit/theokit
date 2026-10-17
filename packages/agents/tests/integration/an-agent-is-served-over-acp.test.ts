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
 * Two defects stood between a served theokit agent and an editor; the first three cases pin them:
 *   - a guarded turn had `wait` only, and the server reads `run.stream()`, so a guarded agent sent
 *     the editor nothing;
 *   - both wrappers rebuilt the handle without `pluginManager`, which the server's default `ask`
 *     mode needs to install its permission plugin, so a wrapped agent failed closed.
 *
 * The last two cases pin what an editor gets when a guard BLOCKS: a JSON-RPC internal error and no
 * text, not the `refusal` stop reason (review round 1, loop-code-review LCR0122). The guarded turn
 * rejects with `GuardrailViolationError` (theokit#139), and the server maps only a run that RESOLVES
 * with `error.code: 'safety_blocked'` to `refusal` (`mapStopReason` in `@theokit/acp` 4.0.1). The
 * redact case above is their control: it shows the fixture does reply BANANA. They run in `auto`
 * mode only, and the input case does not show the prompt never reached the model; the unit test
 * `factory-guardrails-139.test.ts` does.
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

const blockBananaOutput: Guardrail = {
  name: 'block-banana-output',
  checkOutput: (text) =>
    text.includes('BANANA') ? { action: 'block', reason: 'no fruit' } : { action: 'allow' },
}

const blockBananaInput: Guardrail = {
  name: 'block-banana-input',
  checkInput: (text) =>
    text.includes('BANANA') ? { action: 'block', reason: 'no fruit' } : { action: 'allow' },
}

/** JSON-RPC error codes the ACP spec takes from JSON-RPC 2.0. */
const JSON_RPC_INTERNAL_ERROR = -32603

interface SessionUpdate {
  update?: { sessionUpdate?: string; content?: { type?: string; text?: string } }
}

interface ServedEditor {
  client: AcpClient
  /** The text of every `agent_message_chunk` the server sent, in order. */
  agentText: () => string
  serverLog: string[]
  /** Every `error` member of a reply the server sent, decoded. `AcpClient` keeps only the message. */
  errorReplies: () => { code: number; message: string }[]
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
  const rawLines: string[] = []
  serverToClient.on('data', (chunk: Buffer) => rawLines.push(String(chunk)))
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
  return {
    client,
    agentText: () => chunks.join(''),
    serverLog,
    errorReplies: () =>
      rawLines
        .join('')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as { error?: { code: number; message: string } })
        .flatMap((message) => (message.error === undefined ? [] : [message.error])),
  }
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

  it('test_an_output_guard_block_reaches_the_editor_as_an_internal_error_with_no_text', async () => {
    const editor = serveAgent({ guardrails: [blockBananaOutput] }, 'auto')

    await expect(promptOnce(editor)).rejects.toThrow(
      'Guardrail "block-banana-output" blocked output: no fruit',
    )
    expect(editor.errorReplies()).toEqual([
      {
        code: JSON_RPC_INTERNAL_ERROR,
        message: 'Guardrail "block-banana-output" blocked output: no fruit',
      },
    ])
    expect(editor.agentText()).toBe('')
  })

  it('test_an_input_guard_block_reaches_the_editor_as_an_internal_error_with_no_text', async () => {
    const editor = serveAgent({ guardrails: [blockBananaInput] }, 'auto')

    await expect(promptOnce(editor)).rejects.toThrow(
      'Guardrail "block-banana-input" blocked input: no fruit',
    )
    expect(editor.errorReplies()).toEqual([
      {
        code: JSON_RPC_INTERNAL_ERROR,
        message: 'Guardrail "block-banana-input" blocked input: no fruit',
      },
    ])
    expect(editor.agentText()).toBe('')
  })
})
