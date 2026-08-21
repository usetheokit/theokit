/**
 * One request, one trace — read off the EXPORTED payload (usetheokit/theokit#385, #381).
 *
 * ## Why these assertions are made against bytes and not against objects
 *
 * Both defects were of the shape "the value exists and never reaches the collector". The trace id
 * was resolved on every request and written to the `requestId` attribute; the thread route held the
 * `Request` two lines from the call that needed it. A test asserting `span.attributes` or a
 * recorder's captured `context` argument would have agreed with the code in both cases, because in
 * both cases the in-process value was fine.
 *
 * So every assertion below reads the serialized OTLP body the exporter actually POSTs, through the
 * production `TheoCloudObservabilityAdapter` and the production `serializeSpansToOtlp`. Confirmed
 * failing before the fix: the `http.request` span came back with a freshly minted 32-hex `traceId`
 * and the sent id sitting in the `requestId` attribute, and the thread run's `agent.run` came back
 * with a trace of its own.
 *
 * ## What is mocked, and what deliberately is not
 *
 * Only `streamAgentUIMessages` and `compileAgentModule` — the LLM runtime. Everything the defects
 * live in is real: the routes, the CSRF gate, the durable transport, the observability bootstrap,
 * the span implementation, the serializer and the exporter. The J9 measurement scripted the agent's
 * wire chunks the same way, for the same reason: nothing here is a claim about a model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerResponse } from 'node:http'

const SENT_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const SENT_PARENT = '00f067aa0ba902b7'
const TRACEPARENT = `00-${SENT_TRACE}-${SENT_PARENT}-01`

/** The chunks a served run emits. Shaped like the wire, not like the assertions below. */
async function* scriptedRun(): AsyncGenerator {
  yield { type: 'start' }
  yield { type: 'tool-input-available', toolCallId: 'call-1', toolName: 'order_lookup', input: {} }
  yield { type: 'tool-output-available', toolCallId: 'call-1', output: {} }
  yield { type: 'finish' }
}

vi.mock('@theokit/agents', () => ({
  compileAgentModule: () => ({ tools: [], agents: {}, model: 'anthropic/claude-sonnet-4-6' }),
  resolveEnabledSkills: () => undefined,
  streamAgentUIMessages: () => scriptedRun(),
}))

const { mountAgent } = await import('../../packages/theo/src/server/agent/mount-agent.js')
const { handleThreadMessage } =
  await import('../../packages/theo/src/server/agent/handle-thread-routes.js')
const { createObservabilityPlugin } =
  await import('../../packages/theo/src/server/observability/middleware.js')
const { createObservabilityPluginFromConfig, _resetObservabilityAdapter } =
  await import('../../packages/theo/src/server/observability-bootstrap.js')
const { TheoCloudObservabilityAdapter } =
  await import('../../packages/theo/src/server/observability/adapters/theo-cloud.js')
const { getRunEventCache } = await import('../../packages/theo/src/server/agent/run-event-cache.js')

interface ExportedSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  attributes: { key: string; value: Record<string, unknown> }[]
}

const HEX32 = /^[0-9a-f]{32}$/

/**
 * A real exporter whose only fake is the socket. `flushIntervalMs` is parked far out so the only
 * flush is the explicit one below, and the body captured is the exact `Uint8Array` the adapter
 * would have put on the wire.
 */
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
          (
            JSON.parse(body) as {
              resourceSpans: { scopeSpans: { spans: ExportedSpan[] }[] }[]
            }
          ).resourceSpans[0].scopeSpans[0].spans,
      )
    },
  }
}

function attributeOf(span: ExportedSpan, key: string): Record<string, unknown> | undefined {
  return span.attributes.find((a) => a.key === key)?.value
}

function spanNamed(spans: ExportedSpan[], name: string): ExportedSpan {
  const found = spans.find((s) => s.name === name)
  if (found === undefined) throw new Error(`no ${name} span in the exported payload`)
  return found
}

/** Minimal stand-in for the hook surface `register` is handed at boot. */
function createFakeApp() {
  const hooks = new Map<string, ((ctx: never) => void | Promise<void>)[]>()
  return {
    app: {
      addHook(name: string, fn: (ctx: never) => void | Promise<void>) {
        const list = hooks.get(name) ?? []
        list.push(fn)
        hooks.set(name, list)
      },
      decorateRequest() {},
    },
    async fire(name: string, ctx: unknown) {
      for (const fn of hooks.get(name) ?? []) await fn(ctx as never)
    },
  }
}

function agentPost(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/agents/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ message: 'hi' }),
  })
}

function httpContext(request: Request, requestId = 'req-1') {
  return {
    requestId,
    request,
    response: { statusCode: 200 } as ServerResponse,
    ctx: {},
  }
}

/** Drain the SSE body so the run — and therefore its spans — actually completes. */
async function drain(response: Response): Promise<void> {
  const reader = response.body?.getReader()
  if (reader === undefined) return
  for (;;) {
    const { done } = await reader.read()
    if (done) return
  }
}

beforeEach(() => {
  _resetObservabilityAdapter()
})

describe('the http.request span joins the caller trace (usetheokit/theokit#385)', () => {
  it('test_the_exported_http_span_carries_the_trace_id_the_client_sent', async () => {
    const probe = createExportProbe()
    const plugin = createObservabilityPlugin(probe.adapter)
    const { app, fire } = createFakeApp()
    await plugin.register(app as never)

    const ctx = httpContext(agentPost({ traceparent: TRACEPARENT }))
    await fire('onRequest', ctx)
    await fire('onResponse', ctx)

    const span = spanNamed(await probe.exported(), 'http.request')

    // The whole defect in one assertion: this used to be a fresh random value, while the sent id
    // was present on the same span as the `requestId` attribute — a field no backend correlates on.
    expect(span.traceId).toBe(SENT_TRACE)
  })

  it('test_the_exported_http_span_hangs_under_the_caller_span_it_was_told_about', async () => {
    const probe = createExportProbe()
    const { app, fire } = createFakeApp()
    await createObservabilityPlugin(probe.adapter).register(app as never)

    const ctx = httpContext(agentPost({ traceparent: TRACEPARENT }))
    await fire('onRequest', ctx)
    await fire('onResponse', ctx)

    expect(spanNamed(await probe.exported(), 'http.request').parentSpanId).toBe(SENT_PARENT)
  })

  it('test_a_request_with_no_traceparent_still_roots_a_wellformed_trace', async () => {
    const probe = createExportProbe()
    const { app, fire } = createFakeApp()
    await createObservabilityPlugin(probe.adapter).register(app as never)

    const ctx = httpContext(agentPost())
    await fire('onRequest', ctx)
    await fire('onResponse', ctx)

    const span = spanNamed(await probe.exported(), 'http.request')
    expect(span.traceId).toMatch(HEX32)
    expect(span.parentSpanId).toBeUndefined()
  })

  it('test_an_x_request_id_is_refused_as_a_trace_id', async () => {
    const probe = createExportProbe()
    const { app, fire } = createFakeApp()
    await createObservabilityPlugin(probe.adapter).register(app as never)

    // A correlation key an operator may well send, and NOT a trace id: exporting a dashed UUID
    // under `traceId` is a malformed span. It must still reach the span as an attribute.
    const requestId = '2f1c9a44-0f1e-4a2b-9c1d-8e7f6a5b4c3d'
    const ctx = httpContext(agentPost({ 'x-request-id': requestId }), requestId)
    await fire('onRequest', ctx)
    await fire('onResponse', ctx)

    const span = spanNamed(await probe.exported(), 'http.request')
    expect(span.traceId).not.toBe(requestId)
    expect(span.traceId).toMatch(HEX32)
    expect(attributeOf(span, 'requestId')).toEqual({ stringValue: requestId })
  })

  it('test_one_request_that_runs_an_agent_reaches_the_collector_as_ONE_trace', async () => {
    const probe = createExportProbe()
    // The production bootstrap, so `mountAgent` resolves the SAME adapter the hooks export to —
    // two independently resolved adapters would be two half-pictures of one request.
    const plugin = createObservabilityPluginFromConfig({ provider: probe.adapter }, {})
    expect(plugin).toBeDefined()
    const { app, fire } = createFakeApp()
    await plugin?.register(app as never)

    const request = agentPost({ traceparent: TRACEPARENT })
    const ctx = httpContext(request)
    await fire('onRequest', ctx)
    await drain(await mountAgent({}, request, 'sk-test', { csrfMode: 'off', source: 'chat' }))
    await fire('onResponse', ctx)

    const spans = await probe.exported()
    // Before the fix this returned two distinct ids for one request.
    expect(new Set(spans.map((s) => s.traceId))).toEqual(new Set([SENT_TRACE]))
    expect(spans.map((s) => s.name).sort((a, b) => a.localeCompare(b))).toEqual([
      'agent.run',
      'agent.tool',
      'http.request',
    ])
  })

  it('test_the_run_hangs_under_the_caller_span_rather_than_beside_it', async () => {
    const probe = createExportProbe()
    createObservabilityPluginFromConfig({ provider: probe.adapter }, {})

    const request = agentPost({ traceparent: TRACEPARENT })
    await drain(await mountAgent({}, request, 'sk-test', { csrfMode: 'off', source: 'chat' }))

    const spans = await probe.exported()
    const run = spanNamed(spans, 'agent.run')
    // The caller's span id used to be referenced by nothing at all: the run was a second root
    // inside the caller's trace, so the correlation held and the waterfall's shape was lost.
    expect(run.parentSpanId).toBe(SENT_PARENT)
    expect(spanNamed(spans, 'agent.tool').parentSpanId).toBe(run.spanId)
  })
})

describe('a run trace does not depend on which endpoint started it (usetheokit/theokit#381)', () => {
  it('test_the_thread_route_run_continues_the_trace_the_client_sent', async () => {
    const probe = createExportProbe()
    createObservabilityPluginFromConfig({ provider: probe.adapter }, {})

    const sessionId = `thread-${Date.now()}`
    const response = await handleThreadMessage({
      mod: {},
      apiKey: 'sk-test',
      sessionId,
      request: new Request(`http://localhost/api/agents/chat/threads/${sessionId}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', traceparent: TRACEPARENT },
        body: JSON.stringify({ message: 'hi' }),
      }),
      source: 'chat',
      agentName: 'chat',
      csrfMode: 'off',
    })
    expect(response.status).toBe(202)

    // The follow-up is HEADLESS: the route answered 202 and the run pumps into the durable cache
    // on its own. Wait for the cache to close the run before reading what was exported.
    const { runId } = (await response.json()) as { runId: string }
    await runEnded(runId)

    const run = spanNamed(await probe.exported(), 'agent.run')
    // Before the fix: a freshly minted id, unrelated to the header, on this route only.
    expect(run.traceId).toBe(SENT_TRACE)
    expect(run.parentSpanId).toBe(SENT_PARENT)
  })

  it('test_both_served_routes_produce_the_same_trace_for_the_same_header', async () => {
    const viaPost = createExportProbe()
    createObservabilityPluginFromConfig({ provider: viaPost.adapter }, {})
    const request = agentPost({ traceparent: TRACEPARENT })
    await drain(await mountAgent({}, request, 'sk-test', { csrfMode: 'off', source: 'chat' }))
    const postTrace = spanNamed(await viaPost.exported(), 'agent.run').traceId

    _resetObservabilityAdapter()
    const viaThread = createExportProbe()
    createObservabilityPluginFromConfig({ provider: viaThread.adapter }, {})
    const sessionId = `thread-parity-${Date.now()}`
    const threadResponse = await handleThreadMessage({
      mod: {},
      apiKey: 'sk-test',
      sessionId,
      request: new Request(`http://localhost/api/agents/chat/threads/${sessionId}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', traceparent: TRACEPARENT },
        body: JSON.stringify({ message: 'hi' }),
      }),
      source: 'chat',
      agentName: 'chat',
      csrfMode: 'off',
    })
    await runEnded(((await threadResponse.json()) as { runId: string }).runId)
    const threadTrace = spanNamed(await viaThread.exported(), 'agent.run').traceId

    expect(threadTrace).toBe(postTrace)
    expect(postTrace).toBe(SENT_TRACE)
  })
})

/** Resolve once the durable cache reports the headless run finished. */
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
