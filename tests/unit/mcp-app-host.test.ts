// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import {
  createGuestMessageHandler,
  mountMcpApp,
  MCP_APP_SANDBOX,
} from '../../packages/theo/src/client/mcp-app-host.js'

/**
 * M30 (ADR-0041) — the client host for MCP App `ui://` resources. The security-critical parts: the
 * iframe is sandboxed (scripts only, NEVER same-origin) and the guest API is a capability-scoped
 * message vocabulary.
 */

describe('M30 — createGuestMessageHandler (pure bridge, no DOM)', () => {
  it('calls a server tool and posts the result back by id', async () => {
    const onCallServerTool = vi.fn(async (tool: string, args: unknown) => ({
      tool,
      args,
      ok: true,
    }))
    const posted: unknown[] = []
    const handle = createGuestMessageHandler({ onCallServerTool }, (m) => posted.push(m))

    await handle({ type: 'callServerTool', id: 'q1', tool: 'get_weather', args: { city: 'Paris' } })

    expect(onCallServerTool).toHaveBeenCalledWith('get_weather', { city: 'Paris' })
    expect(posted).toEqual([
      {
        type: 'callServerTool:result',
        id: 'q1',
        result: { tool: 'get_weather', args: { city: 'Paris' }, ok: true },
      },
    ])
  })

  it('routes sendMessage to onSendMessage', async () => {
    const onSendMessage = vi.fn()
    const handle = createGuestMessageHandler(
      { onCallServerTool: () => undefined, onSendMessage },
      () => {},
    )
    await handle({ type: 'sendMessage', text: 'hello host' })
    expect(onSendMessage).toHaveBeenCalledWith('hello host')
  })

  it('ignores unknown / malformed messages (capability-scoped, not open RPC)', async () => {
    const onCallServerTool = vi.fn()
    const posted: unknown[] = []
    const handle = createGuestMessageHandler({ onCallServerTool }, (m) => posted.push(m))

    await handle({ type: 'evalArbitrary', code: 'steal()' })
    await handle('not-an-object')
    await handle(null)
    await handle({ type: 'callServerTool' }) // missing id/tool

    expect(onCallServerTool).not.toHaveBeenCalled()
    expect(posted).toEqual([])
  })
})

describe('M30 — mountMcpApp (sandboxed iframe)', () => {
  it('mounts a sandboxed iframe with the resource HTML', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const handle = mountMcpApp(
      container,
      { html: '<h1>Weather</h1>' },
      { onCallServerTool: () => 'x' },
    )

    const iframe = handle.iframe
    expect(iframe.tagName).toBe('IFRAME')
    // Security: scripts only, NEVER allow-same-origin.
    expect(iframe.getAttribute('sandbox')).toBe(MCP_APP_SANDBOX)
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(iframe.srcdoc).toBe('<h1>Weather</h1>')
    expect(container.contains(iframe)).toBe(true)

    handle.dispose()
    expect(container.contains(iframe)).toBe(false)
  })

  it('ignores window messages whose source is not the guest iframe', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const onCallServerTool = vi.fn()
    mountMcpApp(container, { html: '<i>x</i>' }, { onCallServerTool })

    // A message from an arbitrary source (not the iframe) must be ignored.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'callServerTool', id: '1', tool: 'x' },
        source: window,
      }),
    )
    expect(onCallServerTool).not.toHaveBeenCalled()
  })
})
