/**
 * A deployed Worker serves the HITL approvals listing (B-185).
 *
 * The item's measurement: `handleListApprovals` ships in exactly two emitted chunks, and a
 * reachability walk over `dist/` finds four entries that reach them — `adapters/agent-mount.js`,
 * the module every deploy adapter calls, is not one. So `GET /api/agents/<name>/approvals` on a
 * deployed target falls through to the run handler, which answers `BAD_REQUEST` because the
 * request carries no message.
 *
 * WHY THE ASSERTION IS POSITIVE. An earlier draft asserted "the body is not BAD_REQUEST", and it
 * was GREEN today: `mountAgent` runs `validateCsrfRequest` before parsing a body, that check never
 * reads the HTTP method, and `csrfMode` defaults to `'strict'` — so a GET without
 * `X-Theo-Action: 1` returns 403 rather than 400, and "not BAD_REQUEST" was already true. The
 * colour turned on a header nobody had named. Asserting the listing itself removes the invented
 * decision: no header choice makes 200-plus-envelope true before the dispatcher exists.
 *
 * WHAT IS STUBBED, AND WHAT IS NOT. `mountAgent` is stubbed because running it for real needs an
 * LLM. The aux dispatch is NOT: `matchAgentAuxRoute` and `serveMatchedAuxRoute` are this
 * framework's own pure routing, and stubbing them would make this a test of the stub.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import {
  matchAgentAuxRoute,
  serveMatchedAuxRoute,
} from '../../packages/theo/src/server/agent/serve-aux-routes.js'

const AGENTS = [{ filePath: 'agents/chat.js', agentPath: '/api/agents/chat', name: 'chat' }]

/**
 * The bare `theokit/…` specifiers the emitted entry imports all resolve here. `mountAgent` records
 * its calls so the test can assert the aux path did NOT reach the run handler — which is the defect
 * itself, not a side effect of it.
 */
const STUB_SOURCE = `
const b = () => globalThis.__THEO_AUX_HARNESS__
export const matchRoute = () => null
export const compilePattern = () => ({})
export const executeRoute = () => {}
export const createProductionLoader = () => () => ({})
export const createWebShim = (r) => { b().shims.push(r); return { req: {}, res: { setHeader() {}, statusCode: 200 }, toResponse: () => new Response('route') } }
export const generateNonce = () => 'test-nonce'
export const buildSecurityHeaders = () => ({ 'x-baseline': '1' })
export const withSecurityHeaders = (r) => r
export const createCloudflareWsBridge = () => ({ handle: () => new Response(null) })
export const renderStreamingWeb = () => new Response('')
export const extractTraceIdFromRequest = () => 't'
export const TRACE_HEADER = 'x-trace-id'
export const createCorsWebHandler = () => null
export const createPluginRunnerFromConfig = async () => undefined
export const resolveTransformer = (s) => ({ name: s })
export const resolveProvider = (...a) => ({ apiKey: 'sk-test' })
export const mountAgent = (...a) => { b().mounted.push(a); return new Response('agent ran') }
export const scanAgents = () => []
// NOT stubbed behaviourally — these delegate to the REAL functions, which the harness holds.
// The stub is a plain .mjs that Node imports directly and cannot read the TypeScript source; the
// vitest context can, so the real dispatch travels through the harness the same way the test's
// own assertions about \`mountAgent\` do. Stubbing the dispatch would make this a test of the stub.
export const createSubjectResolverFromFactory = () => async () => null
export const matchAgentAuxRoute = (...a) => b().matchAgentAuxRoute(...a)
export const serveMatchedAuxRoute = (...a) => b().serveMatchedAuxRoute(...a)
`

let root: string
let stubUrl: string
const mounted: unknown[][] = []
const shims: unknown[] = []

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-aux-dispatch-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  stubUrl = pathToFileURL(join(root, 'theo-stub.mjs')).href

  mkdirSync(join(root, 'agents'), { recursive: true })
  writeFileSync(join(root, 'agents', 'chat.js'), `export const marker = 'chat-module'\n`)

  // The baked identity module the entry imports. It resolves nobody here — this file's subject is
  // DISPATCH, and identity is proved behaviourally in
  // `tests/integration/a-deploy-target-scopes-the-approvals-listing.test.ts`. What it must do is
  // exist, so the emitted import resolves and a `createWebShim` call is present to count.
  mkdirSync(join(root, 'server'), { recursive: true })
  writeFileSync(
    join(root, 'server', 'context.js'),
    `export function createContext() { return {} }\n`,
  )
  ;(globalThis as Record<string, unknown>).__THEO_AUX_HARNESS__ = {
    mounted,
    shims,
    matchAgentAuxRoute,
    serveMatchedAuxRoute,
  }
})

afterAll(() => {
  delete (globalThis as Record<string, unknown>).__THEO_AUX_HARNESS__
})

async function loadWorker(): Promise<{
  fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>
}> {
  const dir = join(root, '.theokit', 'cloudflare')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `worker-${String(mounted.length)}-${String(shims.length)}.mjs`)
  writeFileSync(
    file,
    renderCloudflareWorkerEntry({
      ssrStreaming: false,
      agents: AGENTS,
      // Without this the identity branch emits `const resolveSubject = undefined` and no
      // `createWebShim` call exists in the entry at all — so the shim count below would be
      // trivially zero before and after any fix, which is the non-discriminating criterion this
      // plan spent two panel rounds removing from T1.4. A review found it reappearing here as
      // scaffolding that looked like a check.
      contextModule: 'server/context.js',
    }).replace(/^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm, `$1'${stubUrl}'`),
  )
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  return mod.default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
}

describe('a deployed worker serves the approvals listing (B-185)', () => {
  it('test_the_worker_serves_the_approvals_listing', async () => {
    const worker = await loadWorker()
    const before = mounted.length

    const response = await worker.fetch(
      new Request('https://app.test/api/agents/chat/approvals'),
      {},
      {},
    )

    // The listing itself, not the absence of one particular refusal.
    //
    // WHICH OF THESE THREE IS ACTUALLY RED TODAY, measured by running it: the envelope and the
    // mount count. The status is NOT — `mountAgent` is stubbed here and answers 200, where the
    // real one answers 403 without `X-Theo-Action` and 400 with it. The status assertion is
    // correct and stays (the fix does answer 200), but it is not what fails today, and reading it
    // as the proof would repeat in this file the mistake the plan corrected in itself.
    expect(response.status).toBe(200)
    const body = (await response.json()) as { approvals?: unknown }
    expect(Array.isArray(body.approvals)).toBe(true)

    // The defect stated directly: the aux path must not reach the run handler at all.
    expect(mounted).toHaveLength(before)
  })

  it('test_a_declined_url_builds_no_web_shim', async () => {
    const worker = await loadWorker()
    const before = shims.length

    // An agent nobody scanned: the matcher declines and the lookup 404s, so nothing downstream
    // runs. THIS is what ADR-1 buys — asking the dispatcher first costs a declined request nothing.
    const response = await worker.fetch(
      new Request('https://app.test/api/agents/does-not-exist/approvals'),
      {},
      {},
    )

    expect(response.status).toBe(404)
    expect(
      shims.length - before,
      'a url this dispatcher declines built a web shim, so asking the matcher first is no longer ' +
        'free — which is the whole property ADR-1 trades the ordering for',
    ).toBe(0)
  })

  it('test_a_served_aux_route_does_build_one', async () => {
    const worker = await loadWorker()
    const before = shims.length

    await worker.fetch(new Request('https://app.test/api/agents/chat/approvals'), {}, {})

    // The control. Without it the assertion above passes on an entry that can never build a shim,
    // which is exactly how the first version of this count was written and why it proved nothing.
    expect(
      shims.length - before,
      'the served path built no shim either, so the count above is measuring an entry with no ' +
        'shim call in it rather than a decline',
    ).toBeGreaterThan(0)
  })

  it('test_a_run_request_still_reaches_the_run_handler', async () => {
    const worker = await loadWorker()
    const before = mounted.length

    const response = await worker.fetch(
      new Request('https://app.test/api/agents/chat', { method: 'POST' }),
      {},
      {},
    )

    // The aux branch owns the sub-paths and nothing else. Claiming the agent's own path would break
    // every deployed run, which is the opposite defect.
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('agent ran')
    expect(mounted).toHaveLength(before + 1)
  })
})
