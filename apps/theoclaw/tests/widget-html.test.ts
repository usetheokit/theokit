// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import { createWebchatRoutes } from '../src/webchat/routes.js'
import { WidgetView } from '../web/widget-view.js'

describe('html widget', () => {
  it('draws a script-only sandboxed frame that loads the sandbox route, not srcdoc', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(WidgetView, { widget: { kind: 'html', title: 'Counter', html: '<b>0</b>' } }),
      )
    })
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('src')).toBe('/webchat/sandbox')
    expect(frame?.hasAttribute('srcdoc')).toBe(false)
    await act(async () => root.unmount())
  })

  it('serves a sandbox frame whose own CSP lets inline script run, with no network', async () => {
    const handle = createWebchatRoutes({
      token: 'w'.repeat(40),
      assetsDir: '/unused',
      turnFor: () => async () => ({ ok: true }),
    })
    const response = await handle(new Request('http://localhost/webchat/sandbox'))
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(response.status).toBe(200)
    expect(csp).toContain("script-src 'unsafe-inline'")
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('sandbox allow-scripts')
    expect(csp).toContain("frame-ancestors 'self'")
    expect(response.headers.has('x-frame-options')).toBe(false)
  })
})
