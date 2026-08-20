import { beforeEach, describe, it, expect } from 'vitest'

import {
  _resetObservabilityAdapter,
  createObservabilityPluginFromConfig,
  getObservabilityAdapter,
} from '../../packages/theo/src/server/observability-bootstrap.js'
import { NoopObservabilityAdapter } from '../../packages/theo/src/server/observability/adapters/noop.js'
import { theoConfigSchema } from '../../packages/theo/src/config/schema.js'

/**
 * B-010 / usetheokit/theokit#353 — `adapter-registry.ts` documents
 * `theo.config.ts > observability.provider` as the first source in its
 * resolution chain, and the key did not exist in the schema. The chain's
 * highest-priority entry was unreachable, and nothing failed to say so.
 */

const CLOUD = {
  THEO_CLOUD_INGEST_URL: 'https://ingest.example',
  THEO_CLOUD_API_KEY: 'k',
}

beforeEach(() => {
  // The boot-resolved adapter is process state. Without this, one test that opts
  // in leaves it set for every test after it in the same worker — and the agent
  // spans read it, so the pollution would reach a different file entirely.
  _resetObservabilityAdapter()
})

describe('observability wiring decision (B-010)', () => {
  it('test_the_resolved_adapter_is_reachable_to_callers_that_are_not_the_plugin', () => {
    expect(getObservabilityAdapter()).toBeUndefined()

    createObservabilityPluginFromConfig({}, { NODE_ENV: 'development' })

    // `observeAgentRun` produces its spans far from the request hooks and must
    // use the SAME adapter: two independently resolved adapters mean two
    // exporters and two half-complete pictures of one run.
    expect(getObservabilityAdapter()?.name).toBe('console')
  })

  it('test_the_config_schema_accepts_the_key_its_registry_documents', () => {
    const parsed = theoConfigSchema.parse({ observability: {} })

    expect(parsed.observability).toEqual({ enabled: true })
  })

  it('test_an_app_that_asked_for_nothing_gets_no_plugin', () => {
    expect(createObservabilityPluginFromConfig(undefined, {})).toBeUndefined()
  })

  it('test_an_explicit_opt_out_wins_over_a_configured_exporter', () => {
    expect(createObservabilityPluginFromConfig({ enabled: false }, CLOUD)).toBeUndefined()
  })

  it('test_an_ingest_url_and_key_opt_in_on_their_own', () => {
    const plugin = createObservabilityPluginFromConfig(undefined, CLOUD)

    expect(plugin?.name).toBe('theokit:observability')
  })

  it('test_an_ingest_url_without_a_key_does_not_count_as_configured', () => {
    const half = { THEO_CLOUD_INGEST_URL: CLOUD.THEO_CLOUD_INGEST_URL }

    expect(createObservabilityPluginFromConfig(undefined, half)).toBeUndefined()
  })

  it('test_development_alone_is_not_an_opt_in', () => {
    // Deliberate divergence from step 3 of the registry's documented chain.
    // Honouring it would put a second JSON stream on the stderr that
    // `observability/logger.ts` already writes to, for every `theo dev` that
    // never asked for telemetry. Opting in still resolves to the console
    // adapter in development — what changed is that NODE_ENV alone no longer
    // counts as asking.
    expect(
      createObservabilityPluginFromConfig(undefined, { NODE_ENV: 'development' }),
    ).toBeUndefined()

    expect(createObservabilityPluginFromConfig({}, { NODE_ENV: 'development' })?.name).toBe(
      'theokit:observability',
    )
  })

  it('test_a_provider_that_resolves_to_noop_wires_nothing', () => {
    // The registry never fails — it falls back to noop. A plugin whose every
    // hook is a no-op would cost a runner on the request path and buy nothing.
    const plugin = createObservabilityPluginFromConfig(
      { provider: new NoopObservabilityAdapter() },
      {},
    )

    expect(plugin).toBeUndefined()
  })

  it('test_an_explicit_provider_beats_the_environment', async () => {
    const started: string[] = []
    const noop = new NoopObservabilityAdapter()
    // Built by delegation rather than by spreading the instance: a spread drops
    // the prototype, so the methods this stand-in does not override would vanish.
    const provider = {
      name: 'explicit',
      startSpan(name: string) {
        started.push(name)
        return { setAttribute() {}, setStatus() {}, end() {} }
      },
      counter: noop.counter.bind(noop),
      histogram: noop.histogram.bind(noop),
      log: noop.log.bind(noop),
      flush: noop.flush.bind(noop),
      shutdown: noop.shutdown.bind(noop),
    }

    const plugin = createObservabilityPluginFromConfig({ provider }, CLOUD)

    // Reached at all means the explicit provider won over the cloud env vars,
    // which would otherwise have produced the theo-cloud adapter.
    expect(plugin).toBeDefined()
    const hooks: Record<string, (ctx: never) => void> = {}
    await plugin?.register({
      addHook(name: string, fn: (ctx: never) => void) {
        hooks[name] = fn
      },
      decorateRequest() {},
    } as never)
    hooks.onRequest?.({
      requestId: 'x',
      request: new Request('http://localhost/a'),
      response: {},
      ctx: {},
    } as never)

    expect(started).toEqual(['http.request'])
  })
})
