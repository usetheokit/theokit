/**
 * A deployed entry runs the app's plugins and honours its transformer (usetheokit/theokit#425).
 *
 * ## What was broken
 *
 * On all six Web-standards targets the generated entry built an `executeRoute` context with no
 * `pluginRunner` and no `transformer`. So `onRequest`, `preHandler`, `onResponse` and `onError`
 * were dead on a deployed app while working locally, and a superjson/devalue app serialised one way
 * in development and another in production without telling the client either.
 *
 * ## What is real here and what is stubbed
 *
 * The EMITTED SOURCE is real — every assertion below runs against the exact text the adapter
 * writes, imported as a module. `theokit/server` is stubbed, because the entry resolves it from the
 * deployed app's `node_modules` and this test has no deployment.
 *
 * The stub is deliberately not inert. `executeRoute` there calls `runOnRequest` on whatever runner
 * it was handed, which is what lets the first test observe a hook actually firing rather than
 * observing a field being present. The real `executeRoute` does the same thing at
 * `server/http/execute.ts:181`; what was missing was never the hook loop, only the value reaching it.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'

/** Every target, rendered with and without the module the build emits. */
interface Carried {
  runtimeConfigModule?: string
  serialization?: 'json' | 'superjson'
}

const TARGETS: Record<string, (carried: Carried) => string> = {
  cloudflare: (c) => renderCloudflareWorkerEntry({ ssrStreaming: false, ...c }),
  vercel: (c) => renderVercelFunctionEntry(c),
  netlify: (c) => renderNetlifyFunction(c),
  bun: (c) => renderBunEntry(3000, c),
  'deno-deploy': (c) => renderDenoEntry(3000, c),
  'aws-lambda': (c) => renderAwsLambdaEntry(c),
}

/** Everything an app can carry, so a target that drops one of them is visible. */
const CARRIES_BOTH: Carried = {
  runtimeConfigModule: './theo.runtime-config.mjs',
  serialization: 'superjson',
}

/**
 * The app's own config, as the build writes it beside the entry: a plugin that records the hooks it
 * is asked to run, and a named transformer.
 */
const RUNTIME_CONFIG_SOURCE = `
const fired = []
export const __fired = fired
export default {
  plugins: [
    {
      name: 'recorder',
      register(app) {
        app.addHook('onRequest', () => { fired.push('onRequest') })
      },
    },
  ],
}
`

/**
 * `theokit/server`, as the deployed app resolves it. `executeRoute` records what it received AND
 * drives the runner, so a hook firing is observable rather than inferred.
 */
const STUB_SOURCE = `
const b = () => globalThis.__THEO_PLUGIN_HARNESS__
export const matchRoute = (...a) => b().matchRoute(...a)
export const compilePattern = (...a) => b().compilePattern(...a)
export const createProductionLoader = () => () => ({})
export const scanServerRoutes = () => []
export const scanWebSocketRoutes = () => []
export const createWebShim = (...a) => b().createWebShim(...a)
export const buildSecurityHeaders = () => ({})
export const generateNonce = () => 'n'
export const withSecurityHeaders = (r) => r
export const createCloudflareWsBridge = () => ({ handle: () => new Response(null) })
export const createBunWsBridge = () => ({})
export const createDenoWsBridge = () => ({})
export const renderStreamingWeb = () => new Response('')
export const extractTraceIdFromRequest = () => 't'
export const TRACE_HEADER = 'x-trace-id'
export const createCorsWebHandler = () => null
export const executeRoute = (...a) => b().executeRoute(...a)
export const resolveTransformer = (...a) => b().resolveTransformer(...a)
export const createPluginRunnerFromConfig = async (plugins) => {
  if (!Array.isArray(plugins) || plugins.length === 0) return undefined
  const hooks = []
  for (const p of plugins) await p.register({ addHook: (n, fn) => { hooks.push([n, fn]) } })
  return {
    applyDecorations() {},
    async runOnRequest(ctx) {
      for (const [n, fn] of hooks) if (n === 'onRequest') await fn(ctx)
      return { shortCircuited: false }
    },
  }
}
`

let root: string
let counter = 0
const seen: { pluginRunner?: unknown; transformer?: unknown }[] = []

async function loadEntry(source: string): Promise<Record<string, unknown>> {
  counter += 1
  const file = join(root, `entry-${String(counter)}.mjs`)
  // Bare specifiers go to the stub; RELATIVE ones are left alone, because the runtime-config module
  // is exactly the relative import under test and rewriting it would erase what this file checks.
  writeFileSync(
    file,
    source.replace(/^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm, `$1'./theo-stub.mjs'`),
  )
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-deployed-plugins-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  writeFileSync(join(root, 'theo.runtime-config.mjs'), RUNTIME_CONFIG_SOURCE)
  ;(globalThis as Record<string, unknown>).__THEO_PLUGIN_HARNESS__ = {
    matchRoute: () => ({ route: { filePath: 'r.ts' }, params: {} }),
    // The REAL `resolveTransformer` maps the selector to the built-in; the stub only has to prove
    // the entry called it with what the config declared.
    resolveTransformer: (selector: string) => ({ name: selector }),
    compilePattern: () => ({}),
    createWebShim: () => ({
      req: {},
      // `setHeader` is real work in the entry: `deployedTraceFragment` stamps the trace id on the
      // response before the route runs. A bare object would fail there, before this test reached
      // what it is about.
      res: { setHeader() {}, statusCode: 200 },
      toResponse: () => new Response('ok'),
    }),
    executeRoute: (opts: { pluginRunner?: unknown; transformer?: unknown }) => {
      seen.push({ pluginRunner: opts.pluginRunner, transformer: opts.transformer })
      const runner = opts.pluginRunner as
        | { runOnRequest?: (c: unknown) => Promise<unknown> }
        | undefined
      return runner?.runOnRequest?.({}) ?? Promise.resolve()
    },
  }
})

afterAll(() => {
  delete (globalThis as Record<string, unknown>).__THEO_PLUGIN_HARNESS__
})

describe('a deployed Worker runs the app plugins (usetheokit/theokit#425)', () => {
  it('test_an_onRequest_hook_declared_in_the_app_config_fires_on_a_deployed_request', async () => {
    const mod = await loadEntry(TARGETS.cloudflare(CARRIES_BOTH))
    const worker = mod.default as {
      fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>
    }

    await worker.fetch(new Request('https://app.test/api/hello'), {}, {})

    const config = (await import(
      /* @vite-ignore */ pathToFileURL(join(root, 'theo.runtime-config.mjs')).href
    )) as { __fired: string[] }
    // Before this, nothing put a runner in the context, so this array stayed empty on every
    // deployed request while the same app fired the hook locally.
    expect(config.__fired).toContain('onRequest')
  })

  it('test_the_transformer_declared_in_the_app_config_reaches_executeRoute', async () => {
    const before = seen.length
    const mod = await loadEntry(TARGETS.cloudflare(CARRIES_BOTH))
    const worker = mod.default as {
      fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>
    }

    await worker.fetch(new Request('https://app.test/api/hello'), {}, {})

    const call = seen[before]
    // `executeRoute` emits `x-theo-transformer` off `.name` and serialises with it. Absent, it fell
    // back to `JSON.stringify` and told the client nothing — which is what makes it a data bug and
    // not a formatting one.
    expect((call.transformer as { name?: string } | undefined)?.name).toBe('superjson')
    expect(call.pluginRunner).toBeDefined()
  })
})

describe('every Web-standards target carries both concerns into executeRoute', () => {
  for (const [name, render] of Object.entries(TARGETS)) {
    it(`test_${name.replace(/-/g, '_')}_passes_the_runner_and_the_transformer`, () => {
      const withConfig = render(CARRIES_BOTH)

      // Asserted on the emitted source rather than by driving all six: each target has its own
      // handler signature, and what regressed is the same one line in each — whether the two values
      // reach the call. `await` is part of the property: a pending promise handed to executeRoute
      // is a truthy object with none of the runner's methods, so every hook would silently not fire.
      expect(withConfig).toMatch(/pluginRunner:\s*await\s+THEO_PLUGIN_RUNNER/)
      expect(withConfig).toMatch(/transformer:\s*THEO_TRANSFORMER/)
    })

    it(`test_${name.replace(/-/g, '_')}_stays_unchanged_when_the_app_declares_neither`, () => {
      const bare = render({})

      // An app carrying neither concern must not gain an import of a module the build never wrote.
      expect(bare).not.toMatch(/theo\.runtime-config/)
      expect(bare).not.toMatch(/THEO_PLUGIN_RUNNER/)
      expect(bare).not.toMatch(/THEO_TRANSFORMER/)
    })
  }
})
