import { describe, expect, it } from 'vitest'

import {
  defineAppResource,
  buildResourceDescriptors,
  readAppResource,
} from '../../packages/theo/src/server/agent/mcp-app-resources.js'

/**
 * M30 (ADR-0041) — MCP Apps: `ui://` HTML resources served by the MCP server (M16). A tool can
 * declare a `ui://` resource; the server advertises it via `resources/list` and serves the HTML via
 * `resources/read`. The client renders it in a SANDBOXED iframe (see mcp-app-host.test.ts).
 */

describe('M30 — defineAppResource', () => {
  it('builds a ui:// HTML resource', () => {
    const r = defineAppResource({
      uri: 'ui://weather/card',
      name: 'Weather card',
      html: '<h1>Sunny</h1>',
    })
    expect(r).toEqual({
      uri: 'ui://weather/card',
      name: 'Weather card',
      mimeType: 'text/html',
      html: '<h1>Sunny</h1>',
    })
  })

  it('rejects a uri that is not a ui:// scheme (security: only app UIs)', () => {
    expect(() =>
      defineAppResource({ uri: 'https://evil.example/x', name: 'x', html: '<b>x</b>' }),
    ).toThrow(/ui:\/\//)
  })

  it('rejects empty html', () => {
    expect(() => defineAppResource({ uri: 'ui://x', name: 'x', html: '' })).toThrow(/html/i)
  })
})

describe('M30 — buildResourceDescriptors (resources/list)', () => {
  it('maps app resources to MCP descriptors (no HTML body in the list)', () => {
    const resources = [
      defineAppResource({ uri: 'ui://a', name: 'A', html: '<i>a</i>' }),
      defineAppResource({ uri: 'ui://b', name: 'B', html: '<i>b</i>', description: 'the B card' }),
    ]
    expect(buildResourceDescriptors(resources)).toEqual([
      { uri: 'ui://a', name: 'A', mimeType: 'text/html' },
      { uri: 'ui://b', name: 'B', mimeType: 'text/html', description: 'the B card' },
    ])
  })
})

describe('M30 — readAppResource (resources/read)', () => {
  it('returns the HTML contents for a known uri', () => {
    const resources = [defineAppResource({ uri: 'ui://a', name: 'A', html: '<i>a</i>' })]
    expect(readAppResource(resources, 'ui://a')).toEqual({
      contents: [{ uri: 'ui://a', mimeType: 'text/html', text: '<i>a</i>' }],
    })
  })

  it('returns null for an unknown uri', () => {
    expect(readAppResource([], 'ui://missing')).toBeNull()
  })
})

/**
 * M30 — the MCP handler serves the App resources over JSON-RPC (extends the M16 handler).
 */
import { handleMcpJsonRpc } from '../../packages/theo/src/server/agent/mcp-handler.js'
import { defineAgent } from '../../packages/agents/src/bridge/define-agent.js'

const agentMod = { default: defineAgent({ model: 'claude-sonnet-4-6', tools: [] }) }

async function rpc(
  method: string,
  params: unknown,
  resources: ReturnType<typeof defineAppResource>[],
) {
  const res = await handleMcpJsonRpc(
    agentMod,
    'x',
    { jsonrpc: '2.0', id: 1, method, params },
    resources,
  )
  return (await res.json()) as { result?: unknown; error?: { code: number } }
}

describe('M30 — handleMcpJsonRpc resources methods', () => {
  const resources = [defineAppResource({ uri: 'ui://card', name: 'Card', html: '<b>hi</b>' })]

  it('advertises capabilities.resources in initialize when app resources exist', async () => {
    const out = await rpc('initialize', {}, resources)
    expect((out.result as { capabilities: Record<string, unknown> }).capabilities).toHaveProperty(
      'resources',
    )
  })

  it('omits capabilities.resources when there are none', async () => {
    const out = await rpc('initialize', {}, [])
    expect(
      (out.result as { capabilities: Record<string, unknown> }).capabilities,
    ).not.toHaveProperty('resources')
  })

  it('resources/list returns the declared descriptors', async () => {
    const out = await rpc('resources/list', {}, resources)
    expect(out.result).toEqual({
      resources: [{ uri: 'ui://card', name: 'Card', mimeType: 'text/html' }],
    })
  })

  it('resources/read returns the HTML for a known uri', async () => {
    const out = await rpc('resources/read', { uri: 'ui://card' }, resources)
    expect(out.result).toEqual({
      contents: [{ uri: 'ui://card', mimeType: 'text/html', text: '<b>hi</b>' }],
    })
  })

  it('resources/read errors on an unknown uri', async () => {
    const out = await rpc('resources/read', { uri: 'ui://nope' }, resources)
    expect(out.error?.code).toBe(-32602)
  })
})
