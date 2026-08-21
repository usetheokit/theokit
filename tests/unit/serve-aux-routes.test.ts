import { describe, expect, it } from 'vitest'

import {
  dispatchAuxRoute,
  sourceOf,
  type CountingRequestSource,
} from '../lib/web-request-source.js'
import { defineAgent } from '../../packages/agents/src/bridge/define-agent.js'
import type { AgentNode } from '../../packages/theo/src/server/scan/agent-scan.js'

/**
 * M15/M16 follow-up — the shared aux-route dispatcher used by BOTH dev + prod. Before this, agent
 * cards / MCP / pending-approvals listing were served ONLY in dev, so a built app 404'd them.
 */

const AGENTS: AgentNode[] = [
  {
    name: 'support',
    filePath: '/agents/support.ts',
    agentPath: '/api/agents/support',
  } as AgentNode,
]

const deps = {
  agents: AGENTS,
  loadModule: async () => ({
    default: defineAgent({ model: 'claude-sonnet-4-6', tools: [] }),
    mcp: true,
  }),
  baseUrl: 'https://app.example',
  // M34 (#97) — these tests exercise the MCP dispatch shape, not the CSRF gate (covered by the
  // dedicated `mcp-route-auth.test.ts`), so disable the gate here.
  csrfMode: 'off' as const,
}

/**
 * theokit#400 — the dispatcher takes a DEFERRED request, so the helper hands it one. `sourceOf`
 * also counts conversions, which is what `test_a_path_the_dispatcher_does_not_own_is_answered_
 * without_touching_the_body` below asserts against.
 */
function req(url: string, method = 'GET', body?: unknown): CountingRequestSource {
  return sourceOf(
    new Request(`https://app.example${url}`, {
      method,
      ...(body !== undefined
        ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
        : {}),
    }),
  )
}

describe('the agent aux dispatcher — production parity for card/mcp/list-approvals', () => {
  it('M15 — serves the agent card at /.well-known/<name>/agent-card.json', async () => {
    const path = '/.well-known/support/agent-card.json'
    const res = await dispatchAuxRoute(req(path), path, deps)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const card = (await res!.json()) as { name: string; url: string }
    expect(card.name).toBe('support')
    expect(card.url).toContain('https://app.example')
  })

  it('M16 — serves the MCP JSON-RPC endpoint at /api/agents/<name>/mcp', async () => {
    const path = '/api/agents/support/mcp'
    const res = await dispatchAuxRoute(
      req(path, 'POST', { jsonrpc: '2.0', id: 1, method: 'initialize' }),
      path,
      deps,
    )
    expect(res).not.toBeNull()
    const rpc = (await res!.json()) as { result?: { serverInfo?: { name?: string } } }
    expect(rpc.result?.serverInfo?.name).toBe('support')
  })

  it('M14 — serves the pending-approvals listing at /api/agents/<name>/approvals', async () => {
    const path = '/api/agents/support/approvals'
    const res = await dispatchAuxRoute(req(path), path, deps)
    expect(res).not.toBeNull()
    const body = (await res!.json()) as { approvals: unknown[] }
    expect(Array.isArray(body.approvals)).toBe(true)
  })

  it('falls through (null) for a non-aux path', async () => {
    const path = '/api/agents/support'
    expect(await dispatchAuxRoute(req(path, 'POST'), path, deps)).toBeNull()
  })

  it('falls through (null) for an unknown agent', async () => {
    const path = '/api/agents/ghost/mcp'
    expect(
      await dispatchAuxRoute(
        req(path, 'POST', { jsonrpc: '2.0', id: 1, method: 'initialize' }),
        path,
        deps,
      ),
    ).toBeNull()
  })

  it('falls through (null) on the wrong method (card is GET-only)', async () => {
    const path = '/.well-known/support/agent-card.json'
    expect(await dispatchAuxRoute(req(path, 'POST'), path, deps)).toBeNull()
  })
})

/**
 * M30 wiring — an agent module that exports `appResources` (from `defineAppResource`) has them
 * advertised + served by the MCP endpoint (resources/list) via the serve-aux dispatcher.
 */
import { defineAppResource } from '../../packages/theo/src/server/agent/mcp-app-resources.js'

describe('the agent aux dispatcher — M30 per-agent appResources wiring', () => {
  const withResources = {
    agents: [{ name: 'ui', filePath: '/agents/ui.ts', agentPath: '/api/agents/ui' } as AgentNode],
    loadModule: async () => ({
      default: defineAgent({ model: 'claude-sonnet-4-6', tools: [] }),
      appResources: [defineAppResource({ uri: 'ui://card', name: 'Card', html: '<b>hi</b>' })],
      mcp: true, // M34 — opt into the MCP surface (default-DENY).
    }),
    baseUrl: 'https://app.example',
    csrfMode: 'off' as const,
  }

  it('resources/list returns the module-declared ui:// resources', async () => {
    const path = '/api/agents/ui/mcp'
    const res = await dispatchAuxRoute(
      req(path, 'POST', { jsonrpc: '2.0', id: 1, method: 'resources/list' }),
      path,
      withResources,
    )
    const rpc = (await res!.json()) as { result?: { resources?: { uri: string }[] } }
    expect(rpc.result?.resources).toEqual([
      { uri: 'ui://card', name: 'Card', mimeType: 'text/html' },
    ])
  })

  it('initialize advertises capabilities.resources when the module declares any', async () => {
    const path = '/api/agents/ui/mcp'
    const res = await dispatchAuxRoute(
      req(path, 'POST', { jsonrpc: '2.0', id: 1, method: 'initialize' }),
      path,
      withResources,
    )
    const rpc = (await res!.json()) as { result?: { capabilities?: Record<string, unknown> } }
    expect(rpc.result?.capabilities).toHaveProperty('resources')
  })
})

/**
 * theokit#400 — the dispatcher must decide whose path it is BEFORE it touches the body.
 *
 * The integration test (`tests/integration/start-post-body-reaches-the-route.test.ts`) proves the
 * consequence over a real socket: before the fix, a POST with a JSON body to any `/api` file route
 * never received a response, because this dispatcher's caller converted the Node request — draining
 * its one-shot body stream — in order to learn the path was not its own.
 *
 * This pins the cause rather than the consequence, and it is the guard that fails FIRST if someone
 * adds an aux branch that converts before it falls through. Conversion is counted, not simulated:
 * `sourceOf` increments on every `toRequest()`, so "did not touch the body" is an assertion instead
 * of a comment.
 */
describe('the agent aux dispatcher — a path it does not own costs nothing', () => {
  const notOurs = [
    ['an ordinary /api file route', '/api/probe'],
    ['the agent run route (owned by the sibling branch)', '/api/agents/support'],
    ['an unknown agent under an aux-shaped path', '/api/agents/ghost/mcp'],
    ['an action route', '/api/__actions/checkout/submit'],
    ['a page URL', '/dashboard'],
  ] as const

  for (const [label, path] of notOurs) {
    it(`test_falls_through_without_converting_the_request_for_${path}`, async () => {
      const source = req(path, 'POST', { a: 1 })

      const res = await dispatchAuxRoute(source, path, deps)

      expect(res, `${label} must fall through`).toBeNull()
      expect(source.calls, `${label} must not convert the request`).toBe(0)
    })
  }

  it('test_a_wrong_method_on_an_owned_path_also_falls_through_without_converting', async () => {
    // The card route is GET-only; a POST to it is a fall-through, and fall-throughs are free.
    const path = '/.well-known/support/agent-card.json'
    const source = req(path, 'POST', { a: 1 })

    expect(await dispatchAuxRoute(source, path, deps)).toBeNull()
    expect(source.calls).toBe(0)
  })

  it('test_a_path_it_does_own_still_gets_the_request_exactly_once', async () => {
    // The other half: deferring must not starve the branches that need the body. Exactly once —
    // converting the same Node stream twice yields an empty second body, a silent truncation.
    const path = '/api/agents/support/mcp'
    const source = req(path, 'POST', { jsonrpc: '2.0', id: 1, method: 'initialize' })

    const res = await dispatchAuxRoute(source, path, deps)

    expect(res!.status).toBe(200)
    expect(source.calls).toBe(1)
  })
})
