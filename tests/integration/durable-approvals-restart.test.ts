/**
 * #1960 — a gated tool defers through the REAL `mountAgent` → `buildAgentHitl` → `onDefer` →
 * store path, the app is rebuilt over the same directory, and the approve route resumes the
 * session through `makeApprovalResume` → `mountAgent({ continuation })` → `toolDecisions`.
 *
 * Only the SDK boundary (`createSdkAgentStream`) is a stand-in. It models the SDK's documented
 * contract: a `pre_tool_call` handler returning `{ defer: true }` ends the run with the call
 * pending in the session; `toolDecisions` resumes it, running the hook again with
 * `approvedOnResume` for an allow and answering a deny with an error result carrying the message.
 * The pending call lives in a module map that stands in for the on-disk transcript, so it
 * survives the "restart" the way the real one would.
 */
import 'reflect-metadata'

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

interface Ev {
  type: string
  [k: string]: unknown
}
const sdk = vi.hoisted(() => ({
  transcript: new Map<string, { toolUseId: string; name: string }>(),
  toolRuns: 0,
  /** What the SDK would hand the model as the denied call's tool_result. */
  modelSaw: undefined as string | undefined,
}))

vi.mock('../../packages/agents/src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    (
      _c: unknown,
      _t: unknown,
      _k: string,
      overrides: {
        plugins?: {
          register: (c: { on: (h: string, f: (x: unknown) => unknown) => void }) => void
        }[]
        toolDecisions?: { toolUseId: string; behavior: 'allow' | 'deny'; message?: string }[]
      } = {},
    ) =>
    (_message: string, sessionId: string): AsyncIterable<Ev> => ({
      async *[Symbol.asyncIterator]() {
        let handler: ((x: unknown) => unknown) | undefined
        overrides.plugins?.[0]?.register({
          on: (hook, fn) => {
            if (hook === 'pre_tool_call') handler = fn
          },
        })
        const done = {
          type: 'done',
          result: 'ok',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 1,
          cost: 0,
        }
        const decision = overrides.toolDecisions?.[0]
        if (decision === undefined) {
          const veto = await handler?.({
            name: 'deploy',
            args: { env: 'prod' },
            agentId: 'a',
            runId: 'r',
            toolUseId: 'tu-1',
          })
          if ((veto as { defer?: boolean } | undefined)?.defer === true) {
            sdk.transcript.set(sessionId, { toolUseId: 'tu-1', name: 'deploy' })
            yield done // the run ends deferred
            return
          }
          sdk.toolRuns++
          yield done
          return
        }
        const pending = sdk.transcript.get(sessionId)
        if (pending?.toolUseId !== decision.toolUseId) throw new Error('no such deferred call')
        sdk.transcript.delete(sessionId)
        if (decision.behavior === 'allow') {
          const again = await handler?.({
            name: 'deploy',
            args: { env: 'prod' },
            agentId: 'a',
            runId: 'r2',
            toolUseId: decision.toolUseId,
            approvedOnResume: true,
          })
          if (again !== undefined) throw new Error('an approved call was gated again')
          sdk.toolRuns++
          yield { type: 'tool_call', callId: 'tu-1', toolName: 'deploy', input: { env: 'prod' } }
          yield {
            type: 'tool_result',
            callId: 'tu-1',
            toolName: 'deploy',
            output: 'deployed',
            isError: false,
          }
        } else {
          sdk.modelSaw = `Plugin blocked this tool call: ${decision.message ?? ''}`
          yield {
            type: 'tool_result',
            callId: 'tu-1',
            toolName: 'deploy',
            output: sdk.modelSaw,
            isError: true,
          }
        }
        yield done
      },
    }),
}))

const { defineAgent } = await import('../../packages/agents/src/bridge/define-agent.js')
const { configureApprovalRegistry } =
  await import('../../packages/theo/src/server/agent/approval-registry.js')
const { createDurableApprovalRegistry, createFileApprovalStore } =
  await import('../../packages/theo/src/server/agent/approval-store.js')
const { mountAgent, makeApprovalResume } =
  await import('../../packages/theo/src/server/agent/mount-agent.js')
const { handleAgentApproval } =
  await import('../../packages/theo/src/server/agent/approve-agent.js')
const { handleListDurableApprovals } =
  await import('../../packages/theo/src/server/agent/list-approvals-handler.js')

const dirs: string[] = []
afterEach(() => {
  configureApprovalRegistry(undefined)
  sdk.transcript.clear()
  sdk.toolRuns = 0
  sdk.modelSaw = undefined
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A fresh module value each call: "the app objects are discarded and rebuilt". */
function buildApp() {
  return {
    default: defineAgent({
      model: 'anthropic/claude-sonnet-4-6',
      system: 'ops',
      tools: [
        {
          name: 'deploy',
          description: 'd',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => '',
        },
      ] as never,
      approvals: { deploy: { question: 'Deploy?', onTimeout: 'abort' } },
    }),
  }
}

const OPTS = { agentName: 'chat', csrfMode: 'off' as const }
const post = (url: string, body: unknown) =>
  new Request(`http://x${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

async function deferThenRestart(): Promise<{ dir: string; approvalId: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'approvals-'))
  dirs.push(dir)
  configureApprovalRegistry(createDurableApprovalRegistry(createFileApprovalStore(dir)))
  const run = await mountAgent(
    buildApp(),
    post('/api/agents/chat', { message: 'deploy', sessionId: 's-1' }),
    'k',
    OPTS,
  )
  const wire = await run.text()
  expect(wire).toContain('tool-approval-request')
  expect(sdk.toolRuns).toBe(0)
  expect(readdirSync(dir).filter((f) => f.endsWith('.json'))).toHaveLength(1)

  // The restart: the registry and the app are discarded; only the directory survives.
  configureApprovalRegistry(createDurableApprovalRegistry(createFileApprovalStore(dir)))
  const registry = (
    await import('../../packages/theo/src/server/agent/approval-registry.js')
  ).getApprovalRegistry()
  const listed = (await (await handleListDurableApprovals(registry, undefined, 'chat')).json()) as {
    approvals: { approvalId: string }[]
    scope: string
  }
  expect(listed.scope).toBe('shared')
  expect(listed.approvals).toHaveLength(1)
  return { dir, approvalId: listed.approvals[0].approvalId }
}

async function answer(approvalId: string, body: unknown): Promise<string> {
  const { getApprovalRegistry } =
    await import('../../packages/theo/src/server/agent/approval-registry.js')
  const url = `/api/agents/chat/approve/${approvalId}`
  const request = post(url, body)
  const res = await handleAgentApproval(request, url, getApprovalRegistry(), 'off', {
    resume: makeApprovalResume(buildApp(), request, 'k', OPTS),
  })
  expect(res.status).toBe(200)
  return res.text()
}

describe('a durable approval across a restart', () => {
  it('pending_approval_survives_a_restart', async () => {
    const { approvalId } = await deferThenRestart()
    const wire = await answer(approvalId, { approved: true })
    expect(sdk.toolRuns).toBe(1)
    expect(wire).toContain('deployed')
    expect(wire).toContain('finish')
    // used once
    const { getApprovalRegistry } =
      await import('../../packages/theo/src/server/agent/approval-registry.js')
    const again = await handleAgentApproval(
      post('/x', { approved: true }),
      `/api/agents/chat/approve/${approvalId}`,
      getApprovalRegistry(),
      'off',
      {},
    )
    expect(again.status).toBe(404)
  })

  it('deny_after_restart_reaches_the_model', async () => {
    const { approvalId } = await deferThenRestart()
    await answer(approvalId, { approved: false, reason: 'no' })
    expect(sdk.toolRuns).toBe(0)
    expect(sdk.modelSaw).toBe('Plugin blocked this tool call: no')
  })
})
