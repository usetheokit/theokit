/**
 * A DEPLOYED target scopes the approvals listing by who is asking (B-185).
 *
 * The deploy-target counterpart of `agent-endpoints-refuse-an-unauthenticated-caller.test.ts`,
 * which proves the same property under `theokit start`. The item's second DoD asks for exactly
 * that distinction: the scoping "is exercised THERE and not only under `theokit start`".
 *
 * Nothing about identity is stubbed. The app's `server/context.ts` is the real fixture shape the
 * dev-path test uses — a bearer id off the `authorization` header — and it is BAKED into the entry
 * as a static import, because a Worker has no filesystem to find it on (ADR 0014). The web shim,
 * the aux dispatcher, the subject resolver, the access policy and the approval registry are all
 * the real ones. `mountAgent` is stubbed, because running an agent needs an LLM and no branch
 * here reaches it.
 *
 * What this proves that the unit tests cannot: that the SAME `createContext` an app writes for the
 * dev path keeps working when the request is a Web `Request` synthesised into a `ShimRequest` — the
 * boundary ADR 0014 names as the one thing its decision can break.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { createWebShim } from '../../packages/theo/src/adapters/web-shim.js'
import { getApprovalRegistry } from '../../packages/theo/src/server/agent/approval-registry.js'
import {
  matchAgentAuxRoute,
  serveMatchedAuxRoute,
} from '../../packages/theo/src/server/agent/serve-aux-routes.js'
import { createSubjectResolverFromFactory } from '../../packages/theo/src/server/http/resolve-agent-subject.js'

const AGENTS = [{ filePath: 'agents/chat.js', agentPath: '/api/agents/chat', name: 'chat' }]

/** Only what needs a network or an LLM. Identity and dispatch are the real thing. */
const STUB_SOURCE = `
const b = () => globalThis.__THEO_DEPLOY_IDENTITY_HARNESS__
export const matchRoute = () => null
export const compilePattern = () => ({})
export const executeRoute = () => {}
export const createProductionLoader = () => () => ({})
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
export const scanAgents = () => []
export const mountAgent = () => new Response('agent ran')
export const createWebShim = (...a) => b().createWebShim(...a)
export const matchAgentAuxRoute = (...a) => b().matchAgentAuxRoute(...a)
export const serveMatchedAuxRoute = (...a) => b().serveMatchedAuxRoute(...a)
export const createSubjectResolverFromFactory = (...a) => b().createSubjectResolverFromFactory(...a)
`

const OWNER = 'alice'
const STRANGER = 'bob'
let root: string
let worker: { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'theo-deploy-identity-'))
  writeFileSync(join(root, 'theo-stub.mjs'), STUB_SOURCE)
  const stubUrl = pathToFileURL(join(root, 'theo-stub.mjs')).href
  ;(globalThis as Record<string, unknown>).__THEO_DEPLOY_IDENTITY_HARNESS__ = {
    createWebShim,
    matchAgentAuxRoute,
    serveMatchedAuxRoute,
    createSubjectResolverFromFactory,
  }

  // The app's identity seam, VERBATIM the shape the dev-path test writes — a bearer id off the
  // `authorization` header. `.js` because the emitted entry is a plain `.mjs` Node imports directly.
  mkdirSync(join(root, 'server'), { recursive: true })
  writeFileSync(
    join(root, 'server', 'context.js'),
    [
      'export function createContext({ request }) {',
      "  const header = request.headers['authorization']",
      "  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return {}",
      "  return { subject: { id: header.slice('Bearer '.length) } }",
      '}',
      '',
    ].join('\n'),
  )

  // The agent declares a policy, which is what makes the registry record an owner at all: with no
  // policy `admitAgentRequest` resolves no subject and there is nothing to attribute.
  mkdirSync(join(root, 'agents'), { recursive: true })
  writeFileSync(
    join(root, 'agents', 'chat.js'),
    [
      'export default { model: "anthropic/claude-sonnet-4-6", system: "echo", tools: [] }',
      'export const policy = ({ subject }) =>',
      '  subject === null ? { allowed: false, reason: "not authenticated" } : { allowed: true }',
      '',
    ].join('\n'),
  )

  const dir = join(root, '.theokit', 'cloudflare')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'worker.mjs')
  writeFileSync(
    file,
    renderCloudflareWorkerEntry({
      ssrStreaming: false,
      agents: AGENTS,
      contextModule: 'server/context.js',
    }).replace(/^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gm, `$1'${stubUrl}'`),
  )
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  worker = mod.default as typeof worker

  // Two pending approvals with different owners. The listing must show each caller only theirs.
  const registry = getApprovalRegistry()
  void registry.register('appr-alice', { timeoutMs: 60_000, onTimeout: 'abort', owner: OWNER })
  void registry.register('appr-bob', { timeoutMs: 60_000, onTimeout: 'abort', owner: STRANGER })
})

afterAll(() => {
  const registry = getApprovalRegistry()
  registry.resolve('appr-alice', false)
  registry.resolve('appr-bob', false)
  delete (globalThis as Record<string, unknown>).__THEO_DEPLOY_IDENTITY_HARNESS__
})

async function listAs(bearer: string | null): Promise<Response> {
  return await worker.fetch(
    new Request('https://app.test/api/agents/chat/approvals', {
      headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
    }),
    {},
    {},
  )
}

describe('a deployed target scopes the approvals listing (B-185)', () => {
  it('test_an_owner_is_served_their_own_approvals', async () => {
    const response = await listAs(OWNER)

    // THE bullet: an owner SERVED. Before this, 0 of 23 adapters passed a resolver, so the policy
    // saw `subject: null` and refused the owner exactly like a stranger.
    expect(response.status).toBe(200)
    const body = (await response.json()) as { approvals: { approvalId: string }[] }
    const ids = body.approvals.map((a) => a.approvalId)
    expect(ids).toContain('appr-alice')
  })

  it('test_an_authenticated_non_owner_does_not_see_another_callers_approval', async () => {
    const response = await listAs(STRANGER)

    // Identity resolving is not the property; identity being USED is. A resolver that returned the
    // same subject for everyone would pass the test above and fail this one.
    expect(response.status).toBe(200)
    const body = (await response.json()) as { approvals: { approvalId: string }[] }
    const ids = body.approvals.map((a) => a.approvalId)
    expect(ids).toContain('appr-bob')
    expect(ids).not.toContain('appr-alice')
  })

  it('test_an_unauthenticated_caller_is_refused', async () => {
    const response = await listAs(null)

    // The app's policy refuses a null subject. This is the one case that already worked before
    // B-185 — and it worked for the wrong reason, because EVERY caller was null.
    expect(response.status).toBeGreaterThanOrEqual(400)
  })
})
