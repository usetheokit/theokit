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
 * SI-021, raised by the inventory judge on its third pass, and the deepest gap this audit found.
 *
 * Keep `__theoResolveSubject` `async` and drop the `await` at its two call sites. The entry still
 * PARSES — `node --check` is blind to it — and `resolveSubject` is then a Promise rather than the
 * thunk `agent-access.ts:146` calls. That line runs only when a policy is declared and is not
 * `'public'`, so every policy-gated agent on cloudflare, bun and deno-deploy throws TypeError while
 * every public one is untouched.
 *
 * Measured under that mutation before this test existed: 45/45 across five identity suites, 90/90
 * across all thirteen suites that render or execute an entry, and 7594 passed / 1 failed on the
 * full run. The suite was blind to it end to end.
 *
 * `toContain` does not care whether the string is a program is this change's own lesson. One level
 * up: `node --check` does not care whether the program is CORRECT. Only running it does.
 */
const AGENTS = [{ filePath: 'agents/gated.js', agentPath: '/api/agents/gated', name: 'gated' }]
const OWNER = 'owner-1'

const STUB_SOURCE = `
const b = () => globalThis.__THEO_POLICY_HARNESS__
export const matchRoute = () => null
export const compilePattern = () => ({})
export const executeRoute = () => {}
export const createProductionLoader = () => () => ({})
export const createWebShim = (r) => ({ req: {}, res: { setHeader() {}, statusCode: 200 }, toResponse: () => new Response('route') })
export const generateNonce = () => 'test-nonce'
export const buildSecurityHeaders = () => ({})
export const withSecurityHeaders = (r) => r
export const createCloudflareWsBridge = () => ({ handle: () => new Response(null) })
export const renderStreamingWeb = () => new Response('')
export const extractTraceIdFromRequest = () => 't'
export const TRACE_HEADER = 'x-trace-id'
export const createCorsWebHandler = () => null
export const createPluginRunnerFromConfig = async () => undefined
export const resolveTransformer = (s) => ({ name: s })
export const resolveProvider = () => ({ apiKey: 'sk-test' })
export const mountAgent = () => new Response('agent ran')
export const scanAgents = () => []
// The identity factory is the REAL one in shape: async, returning the thunk the policy calls. The
// harness decides who the caller is from a header, which is what makes an admitted and a refused
// caller two runs of the same emitted program rather than two programs.
export const createSubjectResolverFromFactory = (createContext, req) => {
  const who = b().currentCaller
  return async () => (who === null ? null : { id: who })
}
// NOT stubbed behaviourally: this is the framework's own dispatch, and the policy evaluation this
// test exists to exercise happens inside it.
export const matchAgentAuxRoute = (...a) => b().matchAgentAuxRoute(...a)
export const serveMatchedAuxRoute = (...a) => b().serveMatchedAuxRoute(...a)
`

let root: string
let stubUrl: string
const harness: { currentCaller: string | null; [k: string]: unknown } = {
  currentCaller: null,
  matchAgentAuxRoute,
  serveMatchedAuxRoute,
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-policy-gate-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  stubUrl = pathToFileURL(join(root, 'theo-stub.mjs')).href

  mkdirSync(join(root, 'agents'), { recursive: true })
  // A NON-PUBLIC policy. `agent-access.ts:145` returns early for absent and for `'public'` without
  // ever reading the subject, so either of those would make this test pass under the mutation —
  // the gate only runs for a declared, conditional policy.
  writeFileSync(
    join(root, 'agents', 'gated.js'),
    `export const policy = ({ subject }) =>\n` +
      `  subject?.id === ${JSON.stringify(OWNER)}\n` +
      `    ? { allowed: true }\n` +
      `    : { allowed: false, reason: 'not the owner' }\n`,
  )
  mkdirSync(join(root, 'server'), { recursive: true })
  writeFileSync(join(root, 'server', 'context.js'), `export function createContext() { return {} }\n`)
  ;(globalThis as Record<string, unknown>).__THEO_POLICY_HARNESS__ = harness
})

afterAll(() => {
  delete (globalThis as Record<string, unknown>).__THEO_POLICY_HARNESS__
})

async function loadWorker(tag: string): Promise<{
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
    }).replace(/^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm, `$1'${stubUrl}'`),
  )
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  return mod.default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
}

describe('a policy-gated agent admits through the emitted entry', () => {
  const CARD = 'https://app.test/api/agents/gated/approvals'

  it('test_the_owner_is_admitted_and_the_route_answers', async () => {
    harness.currentCaller = OWNER
    const worker = await loadWorker('owner')

    const response = await worker.fetch(new Request(CARD), {}, {})

    // The assertion that fails under the mutation: `resolveSubject` would be a Promise, and
    // `agent-access.ts:146` calling it throws TypeError, which surfaces as a 500 rather than the
    // listing. Asserting the STATUS is what makes this a test of the program instead of its text.
    const body = await response.text()
    expect(
      response.status,
      `the owner was not admitted (body: ${body.slice(0, 200)})`,
    ).toBe(200)
  })

  it('test_a_stranger_is_refused_rather_than_admitted_or_crashing', async () => {
    harness.currentCaller = 'someone-else'
    const worker = await loadWorker('stranger')

    const response = await worker.fetch(new Request(CARD), {}, {})

    // Refused, and refused for the policy's reason — not 500, which is what a broken resolver
    // produces and which would otherwise read as "the gate worked".
    expect(response.status, 'a stranger was admitted, or the resolver crashed').not.toBe(200)
    expect(response.status, 'the refusal is a server fault, not a policy decision').toBeLessThan(500)
  })

  it('test_an_anonymous_caller_is_refused_by_the_same_gate', async () => {
    harness.currentCaller = null
    const worker = await loadWorker('anon')

    const response = await worker.fetch(new Request(CARD), {}, {})

    expect(response.status, 'an anonymous caller was admitted').not.toBe(200)
    expect(response.status, 'the refusal is a server fault, not a policy decision').toBeLessThan(500)
  })
})
