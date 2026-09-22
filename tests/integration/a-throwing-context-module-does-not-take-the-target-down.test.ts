import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'

/**
 * SI-022, raised by the inventory judge on its fourth pass.
 *
 * B-185 added a TOP-LEVEL static import of the app's own `server/context.js` to the baked entry.
 * Before it, a Worker did not import that module at all. So a module-scope throw in it — the
 * commonest shape being a required-env-var check — went from costing nothing on a Worker to
 * taking the ENTIRE target down: the import fails, the module never evaluates, and every route
 * dies, not only the one that wanted an identity.
 *
 * That is strictly worse than the thing `resolve-agent-subject.ts:69-72` promises. It says a
 * throwing `createContext` "reaches the branch's own error handler and becomes a 500" — a failure
 * scoped to the request that needed identity. A throw at IMPORT time never reaches any handler.
 *
 * Measured before the fix: the emitted worker fails to load with the app's own error text.
 */
const AGENTS = [{ filePath: 'agents/chat.js', agentPath: '/api/agents/chat', name: 'chat' }]

const STUB_SOURCE = `
export const matchRoute = () => null
export const compilePattern = () => ({})
export const executeRoute = () => {}
export const createProductionLoader = () => () => ({})
export const createWebShim = () => ({ req: {}, res: { setHeader() {} }, toResponse: () => new Response('r') })
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
export const resolveProvider = () => ({ apiKey: 'sk-test' })
export const mountAgent = () => new Response('agent ran')
export const scanAgents = () => []
// B-237 — the real one is \`resolve-agent-subject.ts:120\`: it awaits the factory and does NOT
// catch, so a throwing \`createContext\` propagates. Stubbing it to \`null\` would make every test
// below pass on an entry that never calls the app's factory at all, which is the thing under test.
export const createSubjectResolverFromFactory = (createContext) => async () =>
  createContext === undefined ? null : ((await createContext({})) ?? null)
export const matchAgentAuxRoute = () => null
export const serveMatchedAuxRoute = () => new Response('')
`

let root: string
let stubUrl: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-ctx-throws-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  stubUrl = pathToFileURL(join(root, 'theo-stub.mjs')).href
  mkdirSync(join(root, 'agents'), { recursive: true })
  writeFileSync(join(root, 'agents', 'chat.js'), `export const marker = 'chat'\n`)
  mkdirSync(join(root, 'server'), { recursive: true })
  // The shape this is about: a required env var asserted at module scope. Nothing exotic — it is
  // what a context file that reads a secret looks like.
  writeFileSync(
    join(root, 'server', 'throws.js'),
    `throw new Error('THEO_TEST_REQUIRED_KEY is not set')\nexport function createContext() { return {} }\n`,
  )
  writeFileSync(join(root, 'server', 'clean.js'), `export function createContext() { return {} }\n`)
  // B-237 — the INVERSE of `throws.js`: the module evaluates cleanly and the factory throws when
  // CALLED. `resolve-agent-subject.ts:69-72` promises that becomes a 500 — "an application whose
  // identity resolution is broken must not be treated as an anonymous caller, because that reads
  // as a clean refusal and hides the fault".
  writeFileSync(
    join(root, 'server', 'factory-throws.js'),
    `export function createContext() { throw new Error('identity backend unreachable') }\n`,
  )
})

afterAll(() => {
  /* the workspace is a mkdtemp; nothing to undo */
})

async function loadWorker(
  tag: string,
  contextModule: string,
): Promise<{
  fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>
}> {
  // `.theokit/cloudflare/` is where the build writes it, and the emitted imports are `../../<path>`
  // relative to exactly that. A first measurement put the file at the project root and read the
  // resulting 'Cannot find module' as the defect — it was the fixture.
  const dir = join(root, '.theokit', 'cloudflare')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `worker-${tag}.mjs`)
  writeFileSync(
    file,
    renderCloudflareWorkerEntry({
      ssrStreaming: false,
      agents: AGENTS,
      contextModule,
    }).replace(/^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm, `$1'${stubUrl}'`),
  )
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  return mod.default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
}

describe('a throwing context module does not take the target down', () => {
  it('test_a_route_that_needs_no_identity_still_answers', async () => {
    const worker = await loadWorker('throws', 'server/throws.js')

    // The whole point. `/api/hello` is a file route: it wants no subject, and the app's context
    // module is irrelevant to it. Its answer must not depend on whether that module evaluated.
    const response = await worker.fetch(new Request('https://app.test/api/hello'), {}, {})
    expect(
      response,
      'the entry did not even load — a module-scope throw in the app context killed every route',
    ).toBeInstanceOf(Response)
  })

  // The two cases above drive `/api/hello`, which reaches `__theoResolveSubject` in NO form of
  // this code — so they separate the original defect from both fixes, and they do not separate
  // the two fixes from each other. This one does. The first fix awaited the import as an ARGUMENT
  // to `createSubjectResolverFromFactory`, which evaluates it eagerly inside `__theoResolveSubject`
  // — and both call sites await THAT before `agent-access.ts:145` returns early for an absent or
  // `'public'` policy. So the eager form still killed every agent request; only the pages lived.
  // Reverting to `(await __theoContext()).createContext` must fail exactly here and nowhere else.
  it('test_an_agent_request_survives_a_context_module_that_throws', async () => {
    const worker = await loadWorker('throws-agent', 'server/throws.js')

    const response = await worker.fetch(new Request('https://app.test/api/agents/chat'), {}, {})

    expect(
      response.status,
      'the import is evaluated before the policy is consulted — every agent request dies, not just the ones wanting an identity',
    ).toBe(200)
    expect(await response.text()).toBe('agent ran')
  })

  it('test_the_control_a_context_module_that_evaluates_cleanly_loads', async () => {
    // Without this the test above would pass on an entry that imports nothing at all, which is the
    // pre-B-185 state and not the fix.
    const worker = await loadWorker('clean', 'server/clean.js')
    const response = await worker.fetch(new Request('https://app.test/api/hello'), {}, {})
    expect(response, 'the entry fails even with the module evaluating cleanly').toBeInstanceOf(
      Response,
    )
  })
})
