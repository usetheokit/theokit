import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { HttpCode, Header, Redirect } from '../../src/decorators/response.js'
import { getMeta, ROUTE_STATUS, ROUTE_HEADERS, ROUTE_REDIRECT } from '../../src/metadata/index.js'
import type { RedirectMeta } from '../../src/decorators/response.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

describe.skipIf(!isVitest)('T2.2 — Response-shape decorators', () => {
  it('test_http_code_stores_override', () => {
    class Ctrl {
      @HttpCode(204)
      remove() {
        return 'deleted'
      }
    }
    const status = getMeta<number>(ROUTE_STATUS, Ctrl, 'remove')
    expect(status).toBe(204)
  })

  it('test_header_accumulates_multiple', () => {
    class Ctrl {
      @Header('Cache-Control', 'no-store')
      @Header('X-Custom', 'value')
      handler() {
        return 'ok'
      }
    }
    const headers = getMeta<Array<[string, string]>>(ROUTE_HEADERS, Ctrl, 'handler')
    expect(headers).toHaveLength(2)
    // TS decorators apply bottom-up, so X-Custom is pushed first, Cache-Control second
    expect(headers).toContainEqual(['Cache-Control', 'no-store'])
    expect(headers).toContainEqual(['X-Custom', 'value'])
  })

  it('test_redirect_stores_url_and_status', () => {
    class Ctrl {
      @Redirect('https://example.com', 301)
      handler() {}
    }
    const meta = getMeta<RedirectMeta>(ROUTE_REDIRECT, Ctrl, 'handler')
    expect(meta).toEqual({ url: 'https://example.com', status: 301 })
  })

  it('test_redirect_default_status_302', () => {
    class Ctrl {
      @Redirect('https://example.com')
      handler() {}
    }
    const meta = getMeta<RedirectMeta>(ROUTE_REDIRECT, Ctrl, 'handler')
    expect(meta?.status).toBe(302)
  })
})
