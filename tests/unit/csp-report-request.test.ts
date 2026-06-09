/**
 * T5a.2 Phase B slice 4/6 — Web-Standards CSP report handler tests.
 *
 * Verifies `handleCspReportRequest(request, opts): Promise<Response>` is
 * a behaviour-equivalent mirror of `handleCspReport(req, res, opts)` for
 * the Web Request shape. Returns `Response` directly instead of mutating
 * `res`. Same dispatch + same normalizers + same side-effect loop.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase B. The IncomingMessage tests in `csp-report.test.ts` cover
 * the legacy path; this file covers the Web Request path.
 */
import { describe, it, expect } from 'vitest'

import { handleCspReportRequest } from '../../packages/theo/src/server/security/csp-report.js'
import type {
  CspReportHandlerOptions,
  CspViolation,
} from '../../packages/theo/src/server/security/csp-report.js'

interface RecordedHook {
  violations: CspViolation[]
  fn: NonNullable<CspReportHandlerOptions['onViolation']>
}

function recordingHook(): RecordedHook {
  const violations: CspViolation[] = []
  return { violations, fn: (v) => violations.push(v) }
}

describe('handleCspReportRequest (T5a.2 Phase B slice 4/6 — Web shape)', () => {
  // === Legacy application/csp-report ===

  it('accepts legacy application/csp-report payload → 204 + dispatches violation', async () => {
    const { violations, fn } = recordingHook()
    const request = new Request('http://example.com/__theo/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': {
          'blocked-uri': 'https://evil.com/script.js',
          'document-uri': 'https://example.com/page',
          'violated-directive': 'script-src',
        },
      }),
    })
    const response = await handleCspReportRequest(request, { onViolation: fn })
    expect(response.status).toBe(204)
    expect(violations).toHaveLength(1)
    expect(violations[0].blockedUrl).toBe('https://evil.com/script.js')
    expect(violations[0].violatedDirective).toBe('script-src')
  })

  it('EC-2: legacy payload with {"csp-report": null} → 204 no-op (no dispatch)', async () => {
    const { violations, fn } = recordingHook()
    const request = new Request('http://example.com/__theo/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': null }),
    })
    const response = await handleCspReportRequest(request, { onViolation: fn })
    expect(response.status).toBe(204)
    expect(violations).toHaveLength(0)
  })

  it('EC-2: legacy payload with empty {} → 204 no-op (no dispatch)', async () => {
    const { violations, fn } = recordingHook()
    const request = new Request('http://example.com/__theo/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({}),
    })
    const response = await handleCspReportRequest(request, { onViolation: fn })
    expect(response.status).toBe(204)
    expect(violations).toHaveLength(0)
  })

  // === New application/reports+json ===

  it('accepts application/reports+json array → 204 + dispatches each entry', async () => {
    const { violations, fn } = recordingHook()
    const request = new Request('http://example.com/__theo/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/reports+json' },
      body: JSON.stringify([
        {
          type: 'csp-violation',
          body: {
            blockedURL: 'https://evil.com/a.js',
            documentURL: 'https://example.com/p',
            violatedDirective: 'script-src',
          },
        },
        {
          type: 'csp-violation',
          body: {
            blockedURL: 'https://evil.com/b.js',
            documentURL: 'https://example.com/p',
            violatedDirective: 'connect-src',
          },
        },
      ]),
    })
    const response = await handleCspReportRequest(request, { onViolation: fn })
    expect(response.status).toBe(204)
    expect(violations).toHaveLength(2)
    expect(violations[0].blockedUrl).toBe('https://evil.com/a.js')
    expect(violations[1].violatedDirective).toBe('connect-src')
  })

  it('EC-2: reports+json entries lacking body are filtered out (no dispatch)', async () => {
    const { violations, fn } = recordingHook()
    const request = new Request('http://example.com/__theo/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/reports+json' },
      body: JSON.stringify([{ type: 'csp-violation' }, { type: 'csp-violation', body: null }]),
    })
    const response = await handleCspReportRequest(request, { onViolation: fn })
    expect(response.status).toBe(204)
    expect(violations).toHaveLength(0)
  })

  // === Error paths ===

  it('rejects unsupported content-type → 415', async () => {
    const request = new Request('http://example.com/__theo/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not a csp report',
    })
    const response = await handleCspReportRequest(request, {})
    expect(response.status).toBe(415)
  })

  it('rejects malformed JSON → 400', async () => {
    const request = new Request('http://example.com/__theo/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: '{not valid json',
    })
    const response = await handleCspReportRequest(request, {})
    expect(response.status).toBe(400)
  })

  it('rejects body too large (declared Content-Length > MAX_BODY) → 413', async () => {
    const request = new Request('http://example.com/__theo/csp-report', {
      method: 'POST',
      headers: {
        'content-type': 'application/csp-report',
        // 17 KB declared (> 16 KB MAX_BODY)
        'content-length': String(17 * 1024),
      },
      body: 'x'.repeat(100), // actual small body; declared header triggers the cap
    })
    const response = await handleCspReportRequest(request, {})
    expect(response.status).toBe(413)
  })

  // === Side-effect isolation ===

  it('user onViolation throw does not crash the request', async () => {
    const request = new Request('http://example.com/__theo/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': {
          'blocked-uri': 'https://evil.com/script.js',
          'document-uri': 'https://example.com',
          'violated-directive': 'script-src',
        },
      }),
    })
    const response = await handleCspReportRequest(request, {
      onViolation: () => {
        throw new Error('boom — user hook misbehaves')
      },
    })
    expect(response.status).toBe(204)
  })

  it('devtoolsDispatcher throw does not crash the request', async () => {
    const request = new Request('http://example.com/__theo/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': {
          'blocked-uri': 'https://evil.com/script.js',
          'document-uri': 'https://example.com',
          'violated-directive': 'script-src',
        },
      }),
    })
    const response = await handleCspReportRequest(request, {
      devtoolsDispatcher: {
        onCspViolation: () => {
          throw new Error('boom — devtools misbehaves')
        },
      },
    })
    expect(response.status).toBe(204)
  })
})
