/**
 * The Cloudflare Worker serves the page, with the security baseline on it (usetheokit/theokit#412).
 *
 * ## What was measured
 *
 * #412 reports that on `cloudflare` with `ssrStreaming: false` the DOCUMENT carries no CSP, no
 * `X-Frame-Options`, no HSTS and no `nosniff` — the baseline protects the JSON and not the page it
 * is on. Reading the emitted worker for the fix turned up something larger: with streaming off,
 * every non-API request returns `notFoundResponse()`, and the `[site]` bucket `wrangler.toml`
 * declares is consumed by nothing — no `ASSETS` binding, no `__STATIC_CONTENT`, no
 * `kv-asset-handler` anywhere in the adapter.
 *
 * So the document did not lack headers. It did not exist: a Cloudflare deploy of a non-streaming
 * app answered 404 for its own page.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  renderCloudflareWorkerEntry,
  renderWranglerToml,
} from '../../packages/theo/src/adapters/cloudflare.js'

const STUB_SOURCE = `
export const matchRoute = () => null
export const compilePattern = () => ({})
export const executeRoute = () => {}
export const createProductionLoader = () => () => ({})
export const createWebShim = () => ({ req: {}, res: { setHeader() {}, statusCode: 200 }, toResponse: () => new Response('route') })
export const buildSecurityHeaders = () => ({ 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' })
export const withSecurityHeaders = (response, headers) => {
  const merged = new Headers(response.headers)
  for (const [k, v] of Object.entries(headers)) merged.set(k, v)
  return new Response(response.body, { status: response.status, headers: merged })
}
export const createCloudflareWsBridge = () => ({ handle: () => new Response(null) })
export const renderStreamingWeb = () => new Response('')
export const extractTraceIdFromRequest = () => 't'
export const TRACE_HEADER = 'x-trace-id'
export const createCorsWebHandler = () => null
export const createPluginRunnerFromConfig = async () => undefined
export const resolveTransformer = (s) => ({ name: s })
export const mountAgent = async () => new Response('agent')
export const resolveProvider = () => ({ apiKey: 'sk-test' })
export const scanAgents = () => []
`

let root: string
let stubUrl: string
let counter = 0

async function loadWorker(): Promise<{
  fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>
}> {
  counter += 1
  const dir = join(root, `.theokit-${String(counter)}`, 'cloudflare')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'worker.mjs')
  writeFileSync(
    file,
    renderCloudflareWorkerEntry({ ssrStreaming: false }).replace(
      /^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm,
      `$1'${stubUrl}'`,
    ),
  )
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  return mod.default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
}

/** The platform's asset binding, as Workers hands it to `fetch`. */
function envWithAssets() {
  return {
    ASSETS: {
      fetch: () =>
        Promise.resolve(
          new Response('<!doctype html><html><body>page</body></html>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
        ),
    },
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-cf-document-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  stubUrl = pathToFileURL(join(root, 'theo-stub.mjs')).href
})

afterAll(() => {
  /* tmpdir */
})

describe('wrangler.toml declares a binding the worker can actually use', () => {
  it('test_the_asset_directory_is_declared_with_a_binding', () => {
    const toml = renderWranglerToml()

    // `[site]` uploads to KV and needs `kv-asset-handler` plus a `__STATIC_CONTENT` binding, none of
    // which this worker has ever had. Declaring a bucket nothing reads is how the page went missing
    // without any build output saying so.
    expect(toml).toMatch(/^\[assets\]/m)
    expect(toml).toMatch(/^binding\s*=\s*"ASSETS"/m)
    // Anchored to a line start: the emitted comment explains why `[site]` is gone, and a naive
    // substring match would read that explanation as the section still being there.
    expect(toml).not.toMatch(/^\[site\]/m)
  })

  it('test_the_spa_fallback_is_declared_so_a_client_route_is_not_a_404', () => {
    // A client-routed app asks the platform for `/dashboard`, which is no file. Without this the
    // asset handler 404s it and the SPA never boots on a deep link.
    expect(renderWranglerToml()).toMatch(/not_found_handling\s*=\s*"single-page-application"/)
  })
})

describe('the document is served, and carries the baseline', () => {
  it('test_a_page_request_returns_the_asset_rather_than_a_404', async () => {
    const worker = await loadWorker()

    const response = await worker.fetch(
      new Request('https://app.test/dashboard'),
      envWithAssets(),
      {},
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<body>page</body>')
  })

  it('test_the_document_carries_the_same_baseline_the_api_responses_carry', async () => {
    const worker = await loadWorker()

    const response = await worker.fetch(new Request('https://app.test/'), envWithAssets(), {})

    // The whole point of #412: clickjacking and MIME-sniffing defences were protecting the JSON and
    // not the page they are on.
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('test_a_deployment_without_the_binding_says_so_instead_of_crashing', async () => {
    const worker = await loadWorker()

    // An existing `wrangler.toml` that was not regenerated has no `ASSETS` binding. Reading
    // `env.ASSETS.fetch` off `undefined` would be a 500 on every page request; the honest answer is
    // the 404 this target gave before, which is at least the same answer it always gave.
    const response = await worker.fetch(new Request('https://app.test/'), {}, {})

    expect(response.status).toBe(404)
  })
})

describe('the build output states who protects the document (usetheokit/theokit#412)', () => {
  it('test_a_target_whose_handler_serves_the_page_reports_no_caveat', async () => {
    const { describeDeployedSecurityHeaders } =
      await import('../../packages/theo/src/adapters/security-headers.js')

    const out = describeDeployedSecurityHeaders({
      target: 'cloudflare',
      securityHeaders: {},
      mintsNonce: false,
      documentHeaders: 'handler',
    })

    expect(out).not.toMatch(/does NOT pass through this handler/)
  })

  it('test_a_platform_this_build_configures_says_so_rather_than_repeating_the_gap', async () => {
    const { describeDeployedSecurityHeaders } =
      await import('../../packages/theo/src/adapters/security-headers.js')

    const out = describeDeployedSecurityHeaders({
      target: 'vercel',
      securityHeaders: {},
      mintsNonce: false,
      documentHeaders: 'platform-configured',
    })

    // The old message told the operator to configure the platform. This build now emits that
    // configuration, so repeating the instruction sends someone to do work that is already done —
    // and a stale limitation reads exactly like a current one.
    expect(out).not.toMatch(/Configure the document's headers on the platform/)
    expect(out).toMatch(/config this build emits/)
    // And it must not claim more than it can: nothing here has seen a deployed response.
    expect(out).toMatch(/not verified by a deploy/i)
  })

  it('test_a_platform_this_build_does_not_own_still_names_the_gap', async () => {
    const { describeDeployedSecurityHeaders } =
      await import('../../packages/theo/src/adapters/security-headers.js')

    const out = describeDeployedSecurityHeaders({
      target: 'aws-lambda',
      securityHeaders: {},
      mintsNonce: false,
      documentHeaders: 'platform-unmanaged',
    })

    expect(out).toMatch(/does NOT pass through this handler/)
  })
})
