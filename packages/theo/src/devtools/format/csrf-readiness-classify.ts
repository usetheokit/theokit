/**
 * Pure classifier for CSRF Readiness tab fetch failures.
 *
 * Replaces the previous one-size-fits-all "Failed to fetch — wire
 * csrfReadinessStore" hint that surfaced regardless of the actual cause.
 * Maps each failure mode to an actionable `{kind, summary, hint}` so the
 * tab can direct the developer at the real problem (server down vs.
 * endpoint missing vs. unauthorized vs. crashed handler).
 *
 * Tested as a pure function (no DOM, no React, no fetch). The tab
 * consumes this via `classifyCsrfReadinessError(input)` and renders
 * `{summary, hint}` plus styles per `kind`.
 *
 * NEVER use dangerouslySetInnerHTML in any devtools component — see plan EC-20.
 */

export type CsrfReadinessErrorKind =
  | 'store-not-wired' // HTTP 404 — endpoint missing (canonical case)
  | 'server-crash' // HTTP 5xx — server-side handler threw
  | 'unauthorized' // HTTP 401/403 — readiness route gated behind auth
  | 'unexpected-status' // Other 4xx — surface the status, no canned hint
  | 'server-unreachable' // TypeError "Failed to fetch" — dev server down/restarting
  | 'aborted' // AbortError — user navigated away, silent
  | 'unknown-error' // Fallback — unrecognized throw

export interface ClassifiedCsrfReadinessError {
  readonly kind: CsrfReadinessErrorKind
  /** Short, dev-facing description of WHAT happened. */
  readonly summary: string
  /** Actionable hint — WHAT TO DO next. Empty string for `aborted`. */
  readonly hint: string
}

export type CsrfReadinessFailureInput =
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'thrown'; readonly error: unknown }

const NETWORK_ERROR_PATTERN = /failed to fetch|networkerror|network request failed/i

export function classifyCsrfReadinessError(
  input: CsrfReadinessFailureInput,
): ClassifiedCsrfReadinessError {
  if (input.kind === 'http') {
    return classifyHttpStatus(input.status)
  }
  return classifyThrown(input.error)
}

function classifyHttpStatus(status: number): ClassifiedCsrfReadinessError {
  if (status === 404) {
    return {
      kind: 'store-not-wired',
      summary: `Endpoint returned 404 — /__theo/csrf-readiness not registered.`,
      hint: 'Wire `csrfReadinessStore` in the api-middleware options to enable this tab.',
    }
  }
  if (status === 401 || status === 403) {
    return {
      kind: 'unauthorized',
      summary: `Endpoint returned ${String(status)} — the readiness route is auth-gated.`,
      hint: 'Authenticate (e.g. via session) before opening this tab, or move the route outside of requireAuth.',
    }
  }
  if (status >= 500 && status < 600) {
    return {
      kind: 'server-crash',
      summary: `Endpoint returned ${String(status)} — the readiness handler threw.`,
      hint: 'Check dev server logs (terminal running `theokit dev`) for the underlying stack trace.',
    }
  }
  return {
    kind: 'unexpected-status',
    summary: `Endpoint returned unexpected status ${String(status)}.`,
    hint: 'This is not a status the readiness route normally emits. Inspect the response body in Network tab.',
  }
}

function classifyThrown(error: unknown): ClassifiedCsrfReadinessError {
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      kind: 'aborted',
      summary: 'Request aborted.',
      hint: '',
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof TypeError && NETWORK_ERROR_PATTERN.test(message)) {
    return {
      kind: 'server-unreachable',
      summary: 'Dev server unreachable — request failed before any HTTP response.',
      hint: 'Restart the dev server (`theokit dev`) and verify the port matches the browser URL.',
    }
  }
  return {
    kind: 'unknown-error',
    summary: message.length > 0 ? message : 'Unknown error',
    hint: 'Open the browser DevTools Network panel to inspect the failed request.',
  }
}
