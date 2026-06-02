import { createServer, type Server } from 'node:http'

import { expect, test } from '@playwright/test'

/**
 * T2.1 — CSP enforce default actually blocks an externally-injected script.
 *
 * Mirrors SvelteKit's pattern from
 * `.claude/knowledge-base/references/sveltekit/packages/kit/test/apps/options/test/test.js:11`:
 *
 *   - Spawn a sidecar HTTP server on a fixed port (9988).
 *   - The fixture page at `/csp-test` renders
 *     `<script src="http://127.0.0.1:9988/blocked.js" />`.
 *   - The sidecar serves a script that sets `window.pwned = true`.
 *   - Under 0.3.0 CSP enforce (`script-src 'self' 'nonce-X'` with no
 *     external host allowlist), the browser MUST block the script.
 *   - Assertion: `window.pwned === undefined` after page load.
 *
 * If this spec ever fails GREEN→RED, CSP enforce is broken — block the
 * 0.3.0 promote until fixed (per cutover plan v1.1 Phase 4 dependency
 * graph: T2.1 GATES T4.1 publish).
 *
 * Per blueprint Q2 implication: ssr-nonce.spec.ts proves the nonce thread
 * is correct; this spec proves CSP actually enforces the policy.
 */

const SIDECAR_PORT = 9988
const PWNED_SCRIPT = "window.pwned = true; console.log('pwned-script-executed')"

let sidecar: Server | null = null

test.beforeAll(async () => {
  sidecar = createServer((req, res) => {
    if (req.url === '/blocked.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end(PWNED_SCRIPT)
    } else {
      res.writeHead(404).end('not found')
    }
  })
  await new Promise<void>((r) => {
    sidecar?.listen(SIDECAR_PORT, '127.0.0.1', () => {
      r()
    })
  })
})

test.afterAll(async () => {
  await new Promise<void>((r) => {
    sidecar?.close(() => {
      r()
    })
  })
  sidecar = null
})

test.describe('0.3.0 cutover — CSP enforce blocks external scripts (T2.1)', () => {
  test('externally-injected <script> does NOT execute (window.pwned stays undefined)', async ({
    page,
  }) => {
    // Given: the sidecar HTTP server is serving an evil script on
    // localhost:9988 (set up in beforeAll).

    // When: navigate to /csp-test which renders <script src="http://127.0.0.1:9988/blocked.js">
    await page.goto('/csp-test')

    // Wait a beat for any script execution to have fired. The blocked
    // script is small (< 100 bytes) so 250 ms is generous.
    await page.waitForTimeout(250)

    // Then: window.pwned MUST remain undefined (the script was blocked).
    const pwned = await page.evaluate(() => (window as unknown as { pwned?: true }).pwned)
    expect(
      pwned,
      'CSP enforce broken — external script executed and set window.pwned. Block the 0.3.0 promote.',
    ).toBeUndefined()
  })

  test('Content-Security-Policy header includes "script-src" with nonce (no unsafe-inline)', async ({
    request,
  }) => {
    // Sanity: confirm the policy that SHOULD be doing the blocking is in
    // fact present on the response.
    const response = await request.get('/csp-test')
    expect(response.status()).toBe(200)

    const csp = response.headers()['content-security-policy']
    expect(csp, 'CSP header must be present').toBeDefined()
    expect(csp).toMatch(/script-src/)
    expect(csp).toMatch(/'nonce-/)
    // script-src specifically must NOT include 'unsafe-inline' — would
    // defeat the nonce protection for scripts. (style-src may still carry
    // 'unsafe-inline' under 0.3.0 to support React's inline <style> tags.)
    const scriptSrcMatch = csp!.match(/script-src[^;]+/)
    expect(scriptSrcMatch, 'script-src directive must be present in CSP').not.toBeNull()
    expect(scriptSrcMatch![0]).not.toMatch(/'unsafe-inline'/)
  })
})
