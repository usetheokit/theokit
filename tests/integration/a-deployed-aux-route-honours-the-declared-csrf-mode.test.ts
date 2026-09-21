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

/**
 * SI-009 and SI-010, re-opened by this audit's own critique.
 *
 * Both were granted on evidence one level below their claim: `toContain('...CSRF_CONFIG')` and
 * `resolveApiKey` appearing in the emitted deps object. Carrying a field is not honouring a mode,
 * and no test in this tree drove `POST /api/agents/<n>/mcp` on a deploy target at all.
 *
 * `serve-aux-routes.ts:380` is where it is decided: `csrfMode: deps.csrfMode ?? 'strict'`. The
 * default is what makes the omission dangerous — an app declaring `csrf: 'off'` got `off` on the
 * run route and `strict` on its `/mcp` sibling seventeen lines away.
 */
const AGENTS = [{ filePath: 'agents/chat.js', agentPath: '/api/agents/chat', name: 'chat' }]

const STUB_SOURCE = `
const b = () => globalThis.__THEO_CSRF_HARNESS__
export const matchRoute = () => null
export const compilePattern = () => ({})
export const executeRoute = () => {}
export const createProductionLoader = () => () => ({})
export const createWebShim = (r) => ({ req: {}, res: { setHeader() {}, statusCode: 200 }, toResponse: () => new Response('route') })
export const generateNonce = () => 'n'
export const buildSecurityHeaders = () => ({})
export const withSecurityHeaders = (r) => r
export const createCloudflareWsBridge = () => ({ handle: () => new Response(null) })
export const renderStreamingWeb = () => new Response('')
export const extractTraceIdFromRequest = () => 't'
export const TRACE_HEADER = 'x-trace-id'
export const createCorsWebHandler = () => null
export const createPluginRunnerFromConfig = async () => undefined
export const resolveTransformer = (s) => ({ name: s })
export const resolveProvider = (model, o) => { b().providerCalls.push(model); return { apiKey: 'sk-test' } }
export const mountAgent = () => new Response('agent ran')
export const scanAgents = () => []
export const createSubjectResolverFromFactory = () => async () => ({ id: 'someone' })
export const matchAgentAuxRoute = (...a) => b().matchAgentAuxRoute(...a)
export const serveMatchedAuxRoute = (...a) => { b().deps.push(a[2]); return b().serveMatchedAuxRoute(...a) }
`

let root: string
let stubUrl: string
const harness: Record<string, unknown> = {
  deps: [] as Record<string, unknown>[],
  providerCalls: [] as unknown[],
  matchAgentAuxRoute,
  serveMatchedAuxRoute,
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-csrf-aux-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  stubUrl = pathToFileURL(join(root, 'theo-stub.mjs')).href
  mkdirSync(join(root, 'agents'), { recursive: true })
  writeFileSync(
    join(root, 'agents', 'chat.js'),
    `export const marker = 'chat'\nexport const mcp = true\n`,
  )
  mkdirSync(join(root, 'server'), { recursive: true })
  writeFileSync(join(root, 'server', 'context.js'), `export function createContext() { return {} }\n`)
  ;(globalThis as Record<string, unknown>).__THEO_CSRF_HARNESS__ = harness
})

afterAll(() => {
  delete (globalThis as Record<string, unknown>).__THEO_CSRF_HARNESS__
})

async function loadWorker(tag: string, csrf: 'off' | undefined): Promise<{
  fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>
}> {
  const dir = join(root, '.theokit', 'cloudflare')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `worker-${tag}.mjs`)
  writeFileSync(
    file,
    renderCloudflareWorkerEntry({
      ssrStreaming: false,
      agents: AGENTS,
      contextModule: 'server/context.js',
      csrf,
    } as Parameters<typeof renderCloudflareWorkerEntry>[0]).replace(
      /^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm,
      `$1'${stubUrl}'`,
    ),
  )
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  return mod.default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
}

const depsOf = (): Record<string, unknown> =>
  (harness.deps as Record<string, unknown>[]).at(-1) ?? {}

describe('a deployed aux route honours what the app declared', () => {
  it('test_an_app_declaring_csrf_off_gets_off_on_the_mcp_route', async () => {
    const worker = await loadWorker('off', 'off')
    const before = (harness.deps as unknown[]).length

    await worker.fetch(
      new Request('https://app.test/api/agents/chat/mcp', { method: 'POST', body: '{}' }),
      {},
      {},
    )

    expect(
      (harness.deps as unknown[]).length,
      'the mcp route never reached the aux dispatcher at all',
    ).toBeGreaterThan(before)
    // The claim, at the level it is made: the mode the app DECLARED is the mode this route is
    // given. `serve-aux-routes.ts:380` defaults an absent one to 'strict', so reading the value
    // here is what separates honouring from merely carrying.
    expect(depsOf().csrfMode, 'the declared mode did not reach the mcp route').toBe('off')
  })

  it('test_an_app_declaring_nothing_still_gets_the_strict_default', async () => {
    // The control. An assertion that only ever sees 'off' would pass on a fragment that hard-codes
    // it, which is the shape of evidence this pair of items was revoked for.
    const worker = await loadWorker('default', undefined)

    await worker.fetch(
      new Request('https://app.test/api/agents/chat/mcp', { method: 'POST', body: '{}' }),
      {},
      {},
    )

    expect(depsOf().csrfMode ?? 'strict', 'an undeclared mode is no longer strict').toBe('strict')
  })

  it('test_the_thread_follow_up_can_resolve_a_provider_key', async () => {
    // SI-010. The deps must carry a resolver, and it must be CALLABLE — an absent one made the
    // follow-up a permanent NOT_CONFIGURED naming a framework-internal parameter.
    const worker = await loadWorker('thread', undefined)

    await worker.fetch(
      new Request('https://app.test/api/agents/chat/threads/t-1/message', {
        method: 'POST',
        body: JSON.stringify({ message: 'hi' }),
      }),
      {},
      {},
    )

    const resolve = depsOf().resolveApiKey
    expect(typeof resolve, 'the thread route was handed no provider-key resolver').toBe('function')
    expect(
      (resolve as (m: unknown, p: unknown) => string)('gpt-4', []),
      'the resolver is present but answers nothing',
    ).toEqual(expect.any(String))
  })
})
