/**
 * T2.1 fixture page — exercises CSP enforce by injecting an external script.
 *
 * The spec at tests/e2e/csp-blocks-external-script.spec.ts spawns a sidecar
 * HTTP server on localhost:9988 serving /blocked.js that would set
 * window.pwned = true. Because 0.3.0 CSP enforce default ships
 * `script-src 'self' 'nonce-X'` (NO 'unsafe-inline', NO external host
 * allowlist), this external script MUST be blocked by the browser.
 *
 * The assertion in the spec: `window.pwned === undefined`. If it's `true`,
 * CSP enforce is broken — block the 0.3.0 promote until fixed.
 */
export default function Page() {
  return (
    <div>
      <h1>CSP enforce test</h1>
      <p>
        The page injects an external script below. If CSP enforce works, the script is blocked and{' '}
        <code>window.pwned</code> stays <code>undefined</code>.
      </p>
      <script src="http://127.0.0.1:9988/blocked.js" />
    </div>
  )
}
