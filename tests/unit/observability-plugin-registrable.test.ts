import { describe, it, expect } from 'vitest'
import type { ServerResponse } from 'node:http'

import { createObservabilityPlugin } from '../../packages/theo/src/server/observability/middleware.js'
import { createPluginRunnerFromConfig } from '../../packages/theo/src/server/plugins/load-plugins.js'
import type {
  ObservabilityAdapter,
  SpanHandle,
} from '../../packages/theo/src/server/observability/adapters/types.js'

/**
 * B-010 / usetheokit/theokit#353 — `createObservabilityPlugin` returned
 * `{ name, onRequest, onResponse, onError }` while the plugin loader requires
 * `{ name, register }` and throws `InvalidPluginShapeError` otherwise. The
 * obvious wiring — dropping it into `config.plugins` — therefore crashed the
 * boot, which is why "the plugin exists" and "the plugin can be used" were two
 * different facts for as long as nobody tried.
 *
 * The tests drive it through the REAL loader and a real `addHook` surface. A
 * test that calls `plugin.onRequest(...)` directly, as the previous suite did,
 * passes on a plugin no runner can register — it verifies the implementation
 * and not the contract.
 */

function createMockAdapter() {
  const spans: {
    name: string
    attrs: Record<string, unknown>
    status?: string
    message?: string
    ended: boolean
  }[] = []
  const counters: { name: string; value: number; attrs: Record<string, unknown> }[] = []

  const adapter: ObservabilityAdapter = {
    name: 'mock',
    startSpan(name, attrs) {
      const span = {
        name,
        attrs: { ...attrs } as Record<string, unknown>,
        ended: false,
        status: undefined as string | undefined,
        message: undefined as string | undefined,
      }
      const handle: SpanHandle = {
        setAttribute(k, v) {
          span.attrs[k] = v
        },
        setStatus(s, message) {
          span.status = s
          span.message = message
        },
        end() {
          span.ended = true
          spans.push(span)
        },
      }
      return handle
    },
    counter(name, value, attrs) {
      counters.push({ name, value, attrs: { ...attrs } as Record<string, unknown> })
    },
    histogram() {},
    log() {},
    flush: async () => {},
    shutdown: async () => {},
  }

  return { adapter, spans, counters }
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
    names: () => [...hooks.keys()].sort((a, b) => a.localeCompare(b)),
  }
}

function requestContext(requestId: string, url = 'http://localhost/api/test', method = 'GET') {
  return {
    requestId,
    request: new Request(url, { method }),
    response: { statusCode: 200 } as ServerResponse,
    ctx: {},
  }
}

describe('observability plugin is registrable (B-010)', () => {
  it('test_the_plugin_loader_accepts_it_instead_of_throwing_invalid_shape', async () => {
    const { adapter } = createMockAdapter()

    const runner = await createPluginRunnerFromConfig([createObservabilityPlugin(adapter)])

    expect(runner).toBeDefined()
  })

  it('test_register_installs_the_three_lifecycle_hooks', async () => {
    const { adapter } = createMockAdapter()
    const { app, names } = createFakeApp()

    await createObservabilityPlugin(adapter).register(app)

    expect(names()).toEqual(['onError', 'onRequest', 'onResponse'])
  })

  it('test_a_request_response_pair_produces_one_ended_span_from_the_real_context', async () => {
    const { adapter, spans, counters } = createMockAdapter()
    const { app, fire } = createFakeApp()
    await createObservabilityPlugin(adapter).register(app)

    const ctx = requestContext('r1', 'http://localhost/api/users?page=2')
    await fire('onRequest', ctx)
    await fire('onResponse', ctx)

    expect(spans).toHaveLength(1)
    expect(spans[0].attrs.method).toBe('GET')
    // The real context carries an ABSOLUTE url; the span must record the path.
    expect(spans[0].attrs.path).toBe('/api/users')
    expect(spans[0].attrs.status).toBe(200)
    expect(spans[0].status).toBe('ok')
    expect(counters.map((c) => c.name)).toEqual(['http.requests'])
  })

  it('test_an_error_ends_the_span_with_the_error_status', async () => {
    const { adapter, spans, counters } = createMockAdapter()
    const { app, fire } = createFakeApp()
    await createObservabilityPlugin(adapter).register(app)

    const ctx = requestContext('r2')
    await fire('onRequest', ctx)
    await fire('onError', { ...ctx, error: new Error('boom') })

    expect(spans).toHaveLength(1)
    expect(spans[0].status).toBe('error')
    expect(spans[0].message).toBe('boom')
    expect(counters.map((c) => c.name)).toEqual(['http.errors'])
  })

  it('test_spans_whose_response_never_fires_are_bounded_and_exported_not_leaked', async () => {
    const { adapter, spans } = createMockAdapter()
    const { app, fire } = createFakeApp()
    await createObservabilityPlugin(adapter, { maxActiveSpans: 2 }).register(app)

    // Three streams opened, none closed — the SSE shape the module's own comment
    // admits it cannot close. Unbounded, this is a permanent leak per agent run.
    await fire('onRequest', requestContext('s1'))
    await fire('onRequest', requestContext('s2'))
    await fire('onRequest', requestContext('s3'))

    // The evicted span is ENDED, so it reaches the exporter carrying why it was
    // cut. Dropping it silently would trade a memory leak for a data hole.
    expect(spans).toHaveLength(1)
    expect(spans[0].attrs['span.abandoned']).toBe(true)
    expect(spans[0].status).toBe('error')
  })

  it('test_the_plugin_is_named_so_a_runner_can_report_which_plugin_failed', () => {
    const { adapter } = createMockAdapter()

    expect(createObservabilityPlugin(adapter).name).toBe('theokit:observability')
  })

  it('test_concurrent_requests_are_tracked_independently', async () => {
    const { adapter, spans } = createMockAdapter()
    const { app, fire } = createFakeApp()
    await createObservabilityPlugin(adapter).register(app)

    const first = requestContext('r1', 'http://localhost/a')
    const second = requestContext('r2', 'http://localhost/b')
    await fire('onRequest', first)
    await fire('onRequest', second)
    await fire('onResponse', second)
    await fire('onResponse', first)

    expect(spans.map((s) => s.attrs.path)).toEqual(['/b', '/a'])
  })

  it('test_a_response_with_no_prior_request_is_a_no_op', async () => {
    const { adapter, spans, counters } = createMockAdapter()
    const { app, fire } = createFakeApp()
    await createObservabilityPlugin(adapter).register(app)

    await fire('onResponse', requestContext('never-started'))

    expect(spans).toHaveLength(0)
    expect(counters).toHaveLength(0)
  })

  it('test_two_plugin_instances_do_not_share_span_state', async () => {
    const first = createMockAdapter()
    const second = createMockAdapter()
    const appA = createFakeApp()
    const appB = createFakeApp()
    await createObservabilityPlugin(first.adapter).register(appA.app)
    await createObservabilityPlugin(second.adapter).register(appB.app)

    const ctx = requestContext('shared-id')
    await appA.fire('onRequest', ctx)
    await appB.fire('onResponse', ctx)

    // The span map used to be module-global, so B's response closed A's span.
    expect(second.spans).toHaveLength(0)
    expect(first.spans).toHaveLength(0)
  })
})
