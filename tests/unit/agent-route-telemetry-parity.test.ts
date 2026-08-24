/**
 * The agent routes' telemetry, read off the exported payload of a PRODUCTION dispatch
 * (usetheokit/theokit#405, #406).
 *
 * ## Why this drives the handler and not `mountAgent`
 *
 * The J9 measurement that found both defects found them against a published build; the measurement
 * before it drove `mountAgent` directly and passed `source: 'chat'`, so the probe's own argument
 * supplied the value production gets wrong. A test that picks `source` cannot see either defect:
 * one of them IS the value the caller passes, and the other is a lifecycle the caller never runs.
 *
 * So nothing here chooses those. The agent table comes from the real `scanAgents` over a real
 * directory, so `filePath` is what the scanner produces; the request goes through
 * `tryServeAgent` / `tryServeAgentAux`, the same functions `theokit start` calls; the plugin
 * lifecycle is a real `PluginRunner` with the real observability plugin registered on it; and every
 * assertion reads the serialized OTLP body the exporter would have POSTed.
 *
 * Only `@theokit/agents` is mocked — the LLM runtime. Nothing below is a claim about a model.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const MODEL = 'anthropic/claude-sonnet-4-6'

async function* scriptedRun(): AsyncGenerator {
  yield { type: 'start' }
  yield { type: 'tool-input-available', toolCallId: 'call-1', toolName: 'order_lookup', input: {} }
  yield { type: 'tool-output-available', toolCallId: 'call-1', output: {} }
  yield { type: 'finish' }
}

vi.mock('@theokit/agents', () => ({
  compileAgentModule: () => ({ tools: [], agents: {}, model: MODEL }),
  resolveEnabledSkills: () => undefined,
  streamAgentUIMessages: () => scriptedRun(),
}))

const { tryServeAgent, tryServeAgentAux } =
  await import('../../packages/theo/src/cli/commands/start/handlers.js')
const { scanAgents } = await import('../../packages/theo/src/server/scan/agent-scan.js')
const { PluginRunner } = await import('../../packages/theo/src/server/plugins/plugin-runner.js')
const { createObservabilityPluginFromConfig, _resetObservabilityAdapter } =
  await import('../../packages/theo/src/server/observability-bootstrap.js')
const { TheoCloudObservabilityAdapter } =
  await import('../../packages/theo/src/server/observability/adapters/theo-cloud.js')
const { getRunEventCache } = await import('../../packages/theo/src/server/agent/run-event-cache.js')
const { getApprovalRegistry } =
  await import('../../packages/theo/src/server/agent/approval-registry.js')

interface ExportedSpan {
  traceId: string
  spanId: string
  name: string
  attributes: { key: string; value: Record<string, unknown> }[]
}

/** A real exporter whose only fake is the socket (mirrors served-run-trace-continuation.test.ts). */
function createExportProbe() {
  const bodies: string[] = []
  const adapter = new TheoCloudObservabilityAdapter({
    ingestUrl: 'http://collector.invalid/v1/traces',
    token: 'probe',
    flushIntervalMs: 600_000,
    _mockFetch: ((_input: unknown, init: { body?: unknown } | undefined) => {
      bodies.push(new TextDecoder().decode(init?.body as Uint8Array))
      return Promise.resolve(new Response(null, { status: 200 }))
    }) as unknown as typeof globalThis.fetch,
  })
  return {
    adapter,
    async exported(): Promise<ExportedSpan[]> {
      await adapter.flush()
      return bodies.flatMap(
        (body) =>
          (JSON.parse(body) as { resourceSpans: { scopeSpans: { spans: ExportedSpan[] }[] }[] })
            .resourceSpans[0].scopeSpans[0].spans,
      )
    },
    /** Every attribute value on every exported span, as text — for leak assertions. */
    async exportedText(): Promise<string> {
      await adapter.flush()
      return bodies.join('\n')
    },
  }
}

function attr(span: ExportedSpan, key: string): unknown {
  const value = span.attributes.find((a) => a.key === key)?.value
  return value === undefined ? undefined : Object.values(value)[0]
}

function spansNamed(spans: ExportedSpan[], name: string): ExportedSpan[] {
  return spans.filter((s) => s.name === name)
}

/** The app on disk: a real `agents/` directory, so the scanner produces the file path. */
const projectRoot = mkdtempSync(join(tmpdir(), 'theokit-agent-telemetry-'))
mkdirSync(join(projectRoot, 'agents'))
writeFileSync(
  join(projectRoot, 'agents', 'chat.ts'),
  "export const policy = 'public'\nexport const mcp = true\nexport default {}\n",
)
const AGENTS = scanAgents(projectRoot)

function fakeRes(): ServerResponse & { _chunks: string[] } {
  const res = {
    statusCode: 0,
    _chunks: [] as string[],
    setHeader() {},
    writeHead(status: number) {
      this.statusCode = status
      return this
    },
    write(chunk: Uint8Array) {
      this._chunks.push(new TextDecoder().decode(chunk))
      return true
    },
    end() {
      return this
    },
  }
  return res as unknown as ServerResponse & { _chunks: string[] }
}

function ctx(url: string, method: string, body: unknown, runner: unknown) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    req: Object.assign(Readable.from(payload), {
      method,
      url,
      headers: { host: 'localhost', 'content-type': 'application/json', 'x-theo-action': '1' },
    }) as unknown as IncomingMessage,
    res: fakeRes(),
    url,
    requestId: 'req-probe',
    startTime: Date.now(),
    cachedAgents: AGENTS,
    csrfMode: 'strict' as const,
    rateLimiter: null,
    clientDir: '',
    custom404Html: null,
    cachedRoutes: [],
    cachedActions: [],
    loadModule: async () => ({ policy: 'public', mcp: true }),
    serverDir: '',
    projectRoot,
    controllersDistDir: undefined,
    pluginRunner: runner,
    transformer: undefined,
    disallowed: undefined,
  }
}

/** Register the production observability plugin on a real runner + boot the shared adapter. */
async function bootTelemetry(probe: ReturnType<typeof createExportProbe>) {
  const plugin = createObservabilityPluginFromConfig({ provider: probe.adapter }, {})
  if (plugin === undefined) throw new Error('the observability plugin did not resolve')
  const runner = new PluginRunner()
  await runner.register(plugin)
  return runner
}

/** Resolve once the durable cache reports the headless thread run finished. */
async function runEnded(runId: string): Promise<void> {
  const cache = getRunEventCache()
  await new Promise<void>((resolve) => {
    const attached = cache.attach(
      runId,
      -1,
      () => {},
      () => {
        resolve()
      },
    )
    if (!attached.known || attached.ended) resolve()
  })
}

/** POST a thread follow-up through the aux branch and wait for its headless run to end. */
async function driveThreadRoute(runner: unknown, sessionId: string) {
  const url = `/api/agents/chat/threads/${sessionId}/message`
  const c = ctx(url, 'POST', { message: 'hi' }, runner)
  const handled = await tryServeAgentAux(c as never)
  expect(handled).toBe(true)
  const answered = JSON.parse(c.res._chunks.join('')) as { runId?: string }
  if (answered.runId !== undefined) await runEnded(answered.runId)
  return c
}

const savedKey = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  _resetObservabilityAdapter()
  process.env.ANTHROPIC_API_KEY = 'sk-probe'
})

afterAll(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = savedKey
})

describe('the aux routes are visible at the HTTP layer (usetheokit/theokit#405)', () => {
  it('test_the_thread_message_route_emits_an_http_request_span', async () => {
    const probe = createExportProbe()
    const runner = await bootTelemetry(probe)

    await driveThreadRoute(runner, `thread-${String(Date.now())}`)

    const http = spansNamed(await probe.exported(), 'http.request')
    // Before the fix: zero. The run's spans arrived, so the trace held a run with no request.
    expect(http).toHaveLength(1)
    expect(attr(http[0], 'path')).toMatch(/^\/api\/agents\/chat\/threads\//)
  })

  it('test_the_mcp_route_emits_an_http_request_span', async () => {
    const probe = createExportProbe()
    const runner = await bootTelemetry(probe)

    const c = ctx(
      '/api/agents/chat/mcp',
      'POST',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      runner,
    )
    expect(await tryServeAgentAux(c as never)).toBe(true)

    const http = spansNamed(await probe.exported(), 'http.request')
    expect(http).toHaveLength(1)
    expect(attr(http[0], 'path')).toBe('/api/agents/chat/mcp')
  })

  it('test_the_approve_route_emits_an_http_request_span', async () => {
    const probe = createExportProbe()
    const runner = await bootTelemetry(probe)

    // A pending approval the route can settle, registered the way a paused tool registers one.
    const approvalId = 'approval-probe-1'
    void getApprovalRegistry().register(approvalId, {
      timeoutMs: 60_000,
      onTimeout: 'abort',
      toolName: 'refund',
      question: 'ok?',
    })
    const c = ctx(`/api/agents/chat/approve/${approvalId}`, 'POST', { approved: true }, runner)
    expect(await tryServeAgent(c as never)).toBe(true)

    const http = spansNamed(await probe.exported(), 'http.request')
    expect(http).toHaveLength(1)
    expect(attr(http[0], 'path')).toBe(`/api/agents/chat/approve/${approvalId}`)
  })

  it('test_a_url_the_aux_branch_does_not_own_still_costs_nothing', async () => {
    // The branch runs for EVERY url. Instrumenting it must not turn a fall-through into a span —
    // that would double-count every ordinary route and leave an unclosed span behind it.
    const probe = createExportProbe()
    const runner = await bootTelemetry(probe)

    const c = ctx('/api/health', 'GET', undefined, runner)
    expect(await tryServeAgentAux(c as never)).toBe(false)

    expect(await probe.exported()).toEqual([])
  })
})

describe('one agent is one series (usetheokit/theokit#406)', () => {
  it('test_both_routes_report_the_same_agent_for_the_same_agent', async () => {
    const probe = createExportProbe()
    const runner = await bootTelemetry(probe)

    await tryServeAgent(ctx('/api/agents/chat', 'POST', { message: 'hi' }, runner) as never)
    await driveThreadRoute(runner, `thread-parity-${String(Date.now())}`)

    const runs = spansNamed(await probe.exported(), 'agent.run')
    expect(runs).toHaveLength(2)
    // Before the fix: the module's absolute path on one route, `agent "chat"` on the other.
    expect(attr(runs[0], 'agent')).toBe(attr(runs[1], 'agent'))
    expect(attr(runs[0], 'agent')).toBe('chat')
  })

  it('test_no_exported_span_carries_the_servers_filesystem_layout', async () => {
    const probe = createExportProbe()
    const runner = await bootTelemetry(probe)

    await tryServeAgent(ctx('/api/agents/chat', 'POST', { message: 'hi' }, runner) as never)

    // The agent's file path is infrastructure nobody asked to export, and on a developer machine
    // it names the user's home directory.
    expect(await probe.exportedText()).not.toContain(AGENTS[0].filePath)
  })
})
