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
 * SI-020, end to end.
 *
 * Two earlier tests asserted this structurally: one over the fragment (which could not see the
 * host's own dispatch and passed while the arm was dead code), and one over the rendered host entry
 * (which sees the guard but still reads source, not behaviour). This EXECUTES a real emitted worker
 * and asks whether the request arrives.
 *
 * `env.ASSETS` is deliberately absent, which is what the cloudflare entry answers `notFoundResponse()`
 * for. So before the host consulted the card predicate, a card request took the asset branch and
 * 404'd without the dispatcher ever being asked — and the assertion here is that the dispatcher IS
 * asked, recorded at the call rather than inferred from the status.
 */
const AGENTS = [{ filePath: 'agents/chat.js', agentPath: '/api/agents/chat', name: 'chat' }]

const STUB_SOURCE = `
const b = () => globalThis.__THEO_CARD_HARNESS__
export const matchRoute = () => null
export const compilePattern = () => ({})
export const executeRoute = () => {}
export const createProductionLoader = () => () => ({})
export const createWebShim = (r) => ({ req: {}, res: { setHeader() {}, statusCode: 200 }, toResponse: () => new Response('route') })
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
export const resolveProvider = () => ({ apiKey: 'sk-test' })
export const mountAgent = (...a) => { b().mounted.push(a); return new Response('agent ran') }
export const scanAgents = () => []
export const createSubjectResolverFromFactory = () => async () => null
// The dispatcher delegates to the REAL routing, and the harness records every url it was asked
// about. Recording at the CALL is the point: a status code cannot distinguish "the dispatcher
// declined" from "the dispatcher was never consulted", and those are exactly the two states this
// test exists to tell apart.
export const matchAgentAuxRoute = (...a) => { b().asked.push(a[1]); return b().matchAgentAuxRoute(...a) }
export const serveMatchedAuxRoute = (...a) => b().serveMatchedAuxRoute(...a)
`

let root: string
let stubUrl: string
const mounted: unknown[][] = []
const asked: unknown[] = []

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-card-reach-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  stubUrl = pathToFileURL(join(root, 'theo-stub.mjs')).href
  mkdirSync(join(root, 'agents'), { recursive: true })
  writeFileSync(join(root, 'agents', 'chat.js'), `export const marker = 'chat-module'\n`)
  mkdirSync(join(root, 'server'), { recursive: true })
  writeFileSync(
    join(root, 'server', 'context.js'),
    `export function createContext() { return {} }\n`,
  )
  ;(globalThis as Record<string, unknown>).__THEO_CARD_HARNESS__ = {
    mounted,
    asked,
    matchAgentAuxRoute,
    serveMatchedAuxRoute,
  }
})

afterAll(() => {
  delete (globalThis as Record<string, unknown>).__THEO_CARD_HARNESS__
})

async function loadWorker(): Promise<{
  fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>
}> {
  const dir = join(root, '.theokit', 'cloudflare')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `worker-${String(asked.length)}-${String(mounted.length)}.mjs`)
  writeFileSync(
    file,
    renderCloudflareWorkerEntry({
      ssrStreaming: false,
      agents: AGENTS,
      contextModule: 'server/context.js',
    }).replace(/^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm, `$1'${stubUrl}'`),
  )
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  return mod.default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
}

describe('a deployed worker reaches the agent card', () => {
  it('test_a_card_request_is_handed_to_the_aux_dispatcher', async () => {
    const worker = await loadWorker()
    const before = asked.length

    await worker.fetch(new Request('https://app.test/.well-known/chat/agent-card.json'), {}, {})

    expect(
      asked.slice(before),
      'the card request never reached the aux dispatcher — the host answered it before the agents branch',
    ).toContain('/.well-known/chat/agent-card.json')
  })

  it('test_a_card_request_does_not_fall_through_to_the_run_handler', async () => {
    // The other half. Admitting the path into the branch would be worthless — worse than the 404 it
    // replaced — if a url the dispatcher declines then slid into `mountAgent` with a name sliced
    // off a prefix it does not carry.
    const worker = await loadWorker()
    const before = mounted.length

    await worker.fetch(new Request('https://app.test/.well-known/nobody/agent-card.json'), {}, {})

    expect(
      mounted.length,
      'a .well-known url reached the run handler, which would answer 500 for a routing miss',
    ).toBe(before)
  })

  it('test_a_non_card_well_known_url_is_not_handed_to_the_dispatcher', async () => {
    // The control that keeps the two above from passing on a blanket prefix bypass. A product
    // serving `/.well-known/security.txt` must still reach its asset branch.
    const worker = await loadWorker()
    const before = asked.length

    await worker.fetch(new Request('https://app.test/.well-known/security.txt'), {}, {})

    expect(
      asked.slice(before),
      'the guard admits the whole /.well-known/ namespace, so static files under it lose their handler',
    ).not.toContain('/.well-known/security.txt')
  })
})
