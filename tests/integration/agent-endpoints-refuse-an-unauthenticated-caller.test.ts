/**
 * usetheokit/theokit#365 — the framework's own agent endpoints answer to a caller holding nothing.
 *
 * ## Why this boots a server instead of calling `mountAgent`
 *
 * `mountAgent` already accepted a `policy` and a `subject` before this test existed, and a unit test
 * that hands it both proves the gate WORKS. The defect is that the gate is not REACHED: every
 * production caller invoked `mountAgent` without either argument, so the evaluator saw `undefined`
 * and admitted everyone. A green unit suite and an open endpoint are the same measurement when the
 * question is reachability, so this test asks the only question that separates them — it boots the
 * real `createRequestHandler` on a real `node:http` listener and sends real requests over TCP with
 * no credential at all.
 *
 * Everything on the path is the production object: the dispatch chain
 * (`tryServeAgentAux` -> `tryServeAgent` -> ...), the real `createProductionLoader` reading a real
 * `server/context.ts` off disk, the process-wide approval registry the approve route settles, and
 * the CSRF gate in `'strict'` mode. Two things are stand-ins, both BELOW the access decision and
 * named here so nobody mistakes them for the thing under test: the SDK boundary is stubbed to echo
 * (no LLM), and the agent module is supplied in memory by `loadModule` rather than imported from
 * disk, because a raw `import()` of an on-disk agent would escape that stub and reach the network.
 *
 * ## Every probe carries valid CSRF headers, deliberately
 *
 * CSRF was the only gate on this path, and the advisory's point is that it authenticates NOBODY —
 * it refuses a cross-origin POST and says nothing about who is asking. A probe that omitted
 * `x-theo-action` would be refused by CSRF and would prove nothing about authorization, so every
 * request here sends the headers a legitimate same-origin client sends. What separates the probes
 * from the legitimate caller is identity, and only identity.
 *
 * ## The fixture can disagree with the code
 *
 * `server/context.ts` resolves a subject from an `authorization` header — the stand-in for the
 * signed cookie a real application reads. It is a real file, loaded by the real loader, through the
 * real `runMiddlewareAndContext`. If the agent branch fails to reach that seam, the AUTHENTICATED
 * cases below fail too: the subject is `null` and the owner check refuses the owner. So a fix that
 * refuses everybody cannot pass this file (B-022).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { RequestHandlerCtx } from '../../packages/theo/src/cli/commands/start/handlers.js'
import type { RoutePolicyInput } from '../../packages/theo/src/core/contracts/route-policy.js'
import type { AgentNode } from '../../packages/theo/src/server/scan/agent-scan.js'

// The LLM boundary, stubbed to echo. It sits BELOW the access decision — every assertion here is
// about whether the request is admitted, and an admitted request must still produce a real stream
// so the positive cases assert on content rather than on a status alone.
vi.mock('../../packages/agents/src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    () =>
    (message: string): AsyncIterable<{ type: string; [k: string]: unknown }> => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text_delta', content: `Echo: ${message}` }
        yield {
          type: 'done',
          result: `Echo: ${message}`,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 1,
        }
      },
    }),
}))

const { defineAgent } = await import('../../packages/agents/src/bridge/define-agent.js')
const { requireOwner } = await import('../../packages/theo/src/core/contracts/route-policy.js')
const { createRequestHandler } =
  await import('../../packages/theo/src/cli/commands/start/request-handler.js')
const { getApprovalRegistry } =
  await import('../../packages/theo/src/server/agent/approval-registry.js')
const { createProductionLoader } =
  await import('../../packages/theo/src/server/scan/module-loader.js')
const { _resetMiddlewareCacheForTests } =
  await import('../../packages/theo/src/server/http/middleware-runner.js')

/** How long a request may take before we call it unanswered. Refusals answer in single digits. */
const RESPONSE_BUDGET_MS = 3000

const AGENT_FILE = '/agents/chat.mjs'
const AGENTS: AgentNode[] = [{ name: 'chat', filePath: AGENT_FILE, agentPath: '/api/agents/chat' }]

/**
 * The tenant that owns a conversation, read off its id.
 *
 * The application in the J8 measurement derives its session ids server-side as `<tenant>__<thread>`,
 * so ownership is a pure function of the key. Standing in for a database lookup keeps the fixture
 * about the ACCESS decision rather than about storage.
 */
function tenantOf(sessionId: string | undefined): string | null {
  if (typeof sessionId !== 'string') return null
  const at = sessionId.indexOf('__')
  return at > 0 ? sessionId.slice(0, at) : null
}

/** The agent module as the loader hands it over: a definition plus its declared access policy. */
function agentModule(): Record<string, unknown> {
  return {
    default: defineAgent({ model: 'anthropic/claude-sonnet-4-6', system: 'echo', tools: [] }),
    policy: ({ subject, body, params }: RoutePolicyInput) => {
      const p = (params ?? {}) as { endpoint?: string; sessionId?: string }
      const b = (body ?? {}) as { sessionId?: string }
      // The conversation endpoints are owned by the tenant named in the key.
      const sessionId = b.sessionId ?? p.sessionId
      if (sessionId !== undefined) return requireOwner(subject, tenantOf(sessionId))
      // The approval surface has no per-approval owner to compare against; the most this
      // application can say is that the caller is somebody. See the advisory note in the source.
      return subject === null ? { allowed: false, reason: 'not authenticated' } : { allowed: true }
    },
  }
}

let server: Server | undefined
let projectRoot: string
let origin: string

async function startProductionServer(): Promise<void> {
  projectRoot = await mkdtemp(join(tmpdir(), 'tk365-'))
  const serverDir = join(projectRoot, 'server')
  await mkdir(serverDir, { recursive: true })
  // The application's identity seam — the same file every `route()` already reaches. A real app
  // verifies a signed cookie here; a bearer id keeps the fixture about reachability.
  await writeFile(
    join(serverDir, 'context.ts'),
    [
      'export function createContext({ request }) {',
      "  const header = request.headers['authorization']",
      "  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return {}",
      "  return { subject: { id: header.slice('Bearer '.length) } }",
      '}',
      '',
    ].join('\n'),
    'utf8',
  )
  _resetMiddlewareCacheForTests()

  const loadRoute = createProductionLoader()
  const loadModule = async (filePath: string): Promise<Record<string, unknown>> =>
    filePath === AGENT_FILE ? agentModule() : await loadRoute(filePath)

  const running = createServer(
    createRequestHandler({
      buildCtx: (req, res, requestId, startTime): RequestHandlerCtx => ({
        req,
        res,
        url: req.url ?? '/',
        requestId,
        startTime,
        clientDir: projectRoot,
        custom404Html: null,
        cachedRoutes: [],
        cachedActions: [],
        cachedAgents: AGENTS,
        loadModule,
        serverDir,
        projectRoot,
        controllersDistDir: undefined,
        pluginRunner: undefined,
        transformer: undefined,
        csrfMode: 'strict',
        disallowed: undefined,
        rateLimiter: null,
      }),
      securityHeadersConfig: {},
      ssrRender: null,
      ssrRenderStreaming: null,
      ssrStreamingEnabled: false,
      htmlHead: '',
      htmlTail: '',
      indexHtml: '<!doctype html><html></html>',
      custom500Html: null,
    }),
  )
  server = running
  await new Promise<void>((resolve) => running.listen(0, '127.0.0.1', resolve))
  const { port } = running.address() as AddressInfo
  origin = `http://127.0.0.1:${String(port)}`
}

interface Probe {
  status: number
  contentType: string
  text: string
}

/** Send a request the way a same-origin browser client does, optionally carrying an identity. */
async function probe(
  method: string,
  path: string,
  options: { as?: string; body?: unknown } = {},
): Promise<Probe> {
  const headers: Record<string, string> = { 'x-theo-action': '1', origin }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.as !== undefined) headers.authorization = `Bearer ${options.as}`
  let response: Response
  try {
    response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(RESPONSE_BUDGET_MS),
    })
  } catch (err) {
    throw new Error(
      `${method} ${path} produced no complete response within ${String(RESPONSE_BUDGET_MS)} ms: ` +
        (err instanceof Error ? err.message : String(err)),
    )
  }
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    text: await response.text(),
  }
}

beforeAll(async () => {
  // The provider credential the run path resolves once the module is compiled. It is resolved
  // AFTER the access decision, so its absence would turn a refusal into a 500 and hide which gate
  // answered — the run must be able to succeed for a refusal to mean anything.
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-not-a-real-key')
  await startProductionServer()
})

afterAll(async () => {
  vi.unstubAllEnvs()
  const running = server
  server = undefined
  if (running) await new Promise<void>((resolve) => running.close(() => resolve()))
  await rm(projectRoot, { recursive: true, force: true })
})

describe('the agent endpoints of a running build answer only a caller the agent admits', () => {
  it('test_the_run_endpoint_refuses_an_unauthenticated_caller_naming_another_tenants_conversation', async () => {
    const { status, text } = await probe('POST', '/api/agents/chat', {
      body: { message: 'unauthenticated probe', sessionId: 'acme__thread-1' },
    })

    expect(status).toBe(403)
    // The stream is the leak: an admitted run replays the conversation's prior turns.
    expect(text).not.toContain('Echo:')
  })

  it('test_the_run_endpoint_still_serves_the_tenant_that_owns_the_conversation', async () => {
    const { status, text } = await probe('POST', '/api/agents/chat', {
      as: 'acme',
      body: { message: 'hello', sessionId: 'acme__thread-1' },
    })

    expect(status).toBe(200)
    // Asserting on content, not status: a gate that admitted the request but broke the run would
    // pass a status check.
    expect(text).toContain('Echo: hello')
  })

  it('test_the_run_endpoint_refuses_an_authenticated_caller_from_another_tenant', async () => {
    const { status, text } = await probe('POST', '/api/agents/chat', {
      as: 'globex',
      body: { message: 'probe', sessionId: 'acme__thread-1' },
    })

    expect(status).toBe(403)
    expect(text).not.toContain('Echo:')
  })

  it('test_the_thread_follow_up_endpoint_refuses_an_unauthenticated_caller', async () => {
    // The same conversation store, reached by a different door: a fix that gated only the run
    // endpoint would leave this one open on the same key.
    const { status } = await probe('POST', '/api/agents/chat/threads/acme__thread-1/message', {
      body: { message: 'unauthenticated probe' },
    })

    expect(status).toBe(403)
  })

  it('test_the_thread_stream_endpoint_refuses_an_unauthenticated_caller', async () => {
    const { status, contentType } = await probe(
      'GET',
      '/api/agents/chat/threads/acme__thread-1/stream',
    )

    expect(status).toBe(403)
    expect(contentType).not.toContain('text/event-stream')
  })

  it('test_the_approvals_listing_refuses_an_unauthenticated_caller_and_discloses_no_id', async () => {
    const settled = getApprovalRegistry().register('ap-secret-1', {
      timeoutMs: 60_000,
      onTimeout: 'abort',
      toolName: 'wire_transfer',
    })
    try {
      const { status, text } = await probe('GET', '/api/agents/chat/approvals')

      expect(status).toBe(403)
      expect(text).not.toContain('ap-secret-1')
    } finally {
      getApprovalRegistry().resolve('ap-secret-1', false)
      await settled
    }
  })

  it('test_the_approve_endpoint_refuses_an_unauthenticated_caller_and_leaves_the_approval_pending', async () => {
    const settled = getApprovalRegistry().register('ap-secret-2', {
      timeoutMs: 60_000,
      onTimeout: 'abort',
      toolName: 'wire_transfer',
    })
    try {
      const { status } = await probe('POST', '/api/agents/chat/approve/ap-secret-2', {
        body: { approved: true },
      })

      expect(status).toBe(403)
      // The whole of the HITL advisory is that the gated tool RAN. Still pending => it did not.
      expect(
        getApprovalRegistry()
          .list()
          .map((a) => a.approvalId),
      ).toContain('ap-secret-2')
    } finally {
      getApprovalRegistry().resolve('ap-secret-2', false)
      await settled
    }
  })

  it('test_the_approve_endpoint_still_settles_for_a_caller_the_agent_admits', async () => {
    const settled = getApprovalRegistry().register('ap-legit', {
      timeoutMs: 60_000,
      onTimeout: 'abort',
      toolName: 'wire_transfer',
    })

    const { status } = await probe('POST', '/api/agents/chat/approve/ap-legit', {
      as: 'acme',
      body: { approved: true },
    })

    expect(status).toBe(200)
    await expect(settled).resolves.toMatchObject({ approved: true })
  })
})
