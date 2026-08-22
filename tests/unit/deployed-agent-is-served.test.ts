/**
 * A deployed Worker actually serves an agent (usetheokit/theokit#367).
 *
 * The issue's measurement was `grep -rc "agent" packages/theo/src/adapters/*.ts` returning nothing
 * across 14 files: the notion did not exist in that layer, so `/api/agents/chat` matched no file
 * route and fell into the 404 branch on every target.
 *
 * This drives the rendered Cloudflare entry as a real module, with the agent module written where
 * the emitted import expects it — two directories up, the same place `renderBakedRoutes` puts
 * routes, because that is where the entry is written relative to the project root.
 *
 * `theokit/adapters/agent-mount` is stubbed: `mountAgent` is this framework's own function and
 * running it for real would need an LLM. What is NOT stubbed is the routing — which agent module
 * the entry picks, under which name, and what it answers for a name nobody scanned.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'

const AGENTS = [
  { filePath: 'agents/chat.ts', agentPath: '/api/agents/chat', name: 'chat' },
  { filePath: 'agents/triage.ts', agentPath: '/api/agents/triage', name: 'triage' },
]

const STUB_SOURCE = `
const b = () => globalThis.__THEO_AGENT_HARNESS__
export const matchRoute = () => null
export const compilePattern = () => ({})
export const executeRoute = () => {}
export const createProductionLoader = () => () => ({})
export const createWebShim = (r) => ({ req: {}, res: { setHeader() {}, statusCode: 200 }, toResponse: () => new Response('route') })
export const buildSecurityHeaders = () => ({ 'x-baseline': '1' })
export const withSecurityHeaders = (r) => r
export const createCloudflareWsBridge = () => ({ handle: () => new Response(null) })
export const renderStreamingWeb = () => new Response('')
export const extractTraceIdFromRequest = () => 't'
export const TRACE_HEADER = 'x-trace-id'
export const createCorsWebHandler = () => null
export const createPluginRunnerFromConfig = async () => undefined
export const resolveTransformer = (s) => ({ name: s })
export const mountAgent = (...a) => b().mountAgent(...a)
export const resolveProvider = (...a) => b().resolveProvider(...a)
`

let root: string
let stubUrl: string
const mounted: { module: unknown; agentName: unknown }[] = []

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-deployed-agent-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  stubUrl = pathToFileURL(join(root, 'theo-stub.mjs')).href

  // The app's own agent modules, at the path the emitted import names.
  mkdirSync(join(root, 'agents'), { recursive: true })
  writeFileSync(join(root, 'agents', 'chat.ts'), `export const marker = 'chat-module'\n`)
  writeFileSync(join(root, 'agents', 'triage.ts'), `export const marker = 'triage-module'\n`)
  ;(globalThis as Record<string, unknown>).__THEO_AGENT_HARNESS__ = {
    resolveProvider: () => ({ apiKey: 'sk-test' }),
    mountAgent: (
      module: unknown,
      _request: unknown,
      _key: unknown,
      opts: { agentName?: unknown },
    ) => {
      mounted.push({ module, agentName: opts.agentName })
      return new Response('agent ran')
    },
  }
})

afterAll(() => {
  delete (globalThis as Record<string, unknown>).__THEO_AGENT_HARNESS__
})

/**
 * Write the entry two levels below the root, where the build writes it (`.theokit/cloudflare/`),
 * so the emitted `../../agents/chat.ts` resolves to the app module rather than to nothing.
 */
async function loadWorker(): Promise<{
  fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>
}> {
  const dir = join(root, '.theokit', 'cloudflare')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'worker.mjs')
  writeFileSync(
    file,
    renderCloudflareWorkerEntry({ ssrStreaming: false, agents: AGENTS }).replace(
      /^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm,
      `$1'${stubUrl}'`,
    ),
  )
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  return mod.default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
}

describe('an agent is reachable on a deployed target (usetheokit/theokit#367)', () => {
  it('test_a_request_to_the_agent_path_mounts_the_agent_it_names', async () => {
    const worker = await loadWorker()
    const before = mounted.length

    const response = await worker.fetch(
      new Request('https://app.test/api/agents/triage', { method: 'POST' }),
      {},
      {},
    )

    // Before this, no adapter had heard of agents: the path matched no file route and returned 404.
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('agent ran')

    const call = mounted[before]
    // The module picked is the one the NAME maps to, not the first in the table.
    expect((call.module as { marker?: string }).marker).toBe('triage-module')
    // `agentName` is what the access policy is judged under and what the run's spans are labelled
    // with (#406). A deployed run that omitted it would label itself differently from a local one.
    expect(call.agentName).toBe('triage')
  })

  it('test_a_name_nobody_scanned_is_a_404_and_not_a_crash', async () => {
    const worker = await loadWorker()
    const before = mounted.length

    const response = await worker.fetch(
      new Request('https://app.test/api/agents/does-not-exist', { method: 'POST' }),
      {},
      {},
    )

    // Reading `undefined` off the table and handing it to `mountAgent` would surface a routing miss
    // as a 500 — a different fault, reported to the caller as ours.
    expect(response.status).toBe(404)
    expect(mounted).toHaveLength(before)
  })

  it('test_a_non_agent_api_path_still_reaches_the_file_route_table', async () => {
    const worker = await loadWorker()
    const before = mounted.length

    const response = await worker.fetch(new Request('https://app.test/api/hello'), {}, {})

    // The agent branch owns its prefix and nothing else. Claiming all of `/api/` would break every
    // file route on the target, which is the opposite defect.
    expect(mounted).toHaveLength(before)
    expect(response.status).toBe(404)
  })
})
