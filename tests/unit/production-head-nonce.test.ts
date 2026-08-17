import { describe, it, expect } from 'vitest'

import { withHoistedHead } from '../../packages/theo/src/cli/commands/start/request-handler.js'

/**
 * The nonce is per-request; `ctx.htmlHead` is computed once at startup. Production therefore has to
 * stamp the template's own inline scripts on every request, the way the dev middleware already does.
 *
 * The visible symptom of getting this wrong is a theme-init script — the standard cure for a flash
 * of the wrong theme on load — being blocked by CSP in production and only in production, so the
 * page loads white and repaints once React hydrates.
 */
const HEAD = `<html><head><script>document.documentElement.dataset.mode="dark"</script></head><body><div id="root">`

describe('withHoistedHead — nonce on template inline scripts', () => {
  it('stamps the per-request nonce onto an inline script in the template', () => {
    const { head } = withHoistedHead(HEAD, '<h1>Page</h1>', 'abc123')

    expect(head).toContain('<script nonce="abc123">')
  })

  it('still hoists the route metadata while doing it', () => {
    const { head, body } = withHoistedHead(HEAD, '<title>Page</title><h1>Page</h1>', 'abc123')

    expect(head).toContain('<title>Page</title>')
    expect(body).not.toContain('<title>')
  })

  it('leaves external scripts alone', () => {
    const { head } = withHoistedHead(
      `<html><head><script src="/app.js"></script></head><body><div id="root">`,
      '<h1>Page</h1>',
      'abc123',
    )

    expect(head).toContain('<script src="/app.js">')
  })
})
