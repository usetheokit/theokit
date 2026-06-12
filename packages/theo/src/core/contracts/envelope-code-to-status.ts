/**
 * Maps a TheoErrorEnvelope `code` to its canonical HTTP status.
 *
 * Single source of truth — previously duplicated in `web-handler.ts` and
 * `handle-request-error.ts` (architecture-remediation plan T1.2, 2026-06-12).
 */
export function envelopeCodeToStatus(code: string): number {
  switch (code) {
    case 'BAD_REQUEST':
      return 400
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    case 'METHOD_NOT_ALLOWED':
      return 405
    case 'PAYLOAD_TOO_LARGE':
      return 413
    case 'UNPROCESSABLE_ENTITY':
      return 422
    case 'TOO_MANY_REQUESTS':
    case 'RATE_LIMITED':
      return 429
    case 'BAD_GATEWAY':
      return 502
    case 'SERVICE_UNAVAILABLE':
      return 503
    case 'GATEWAY_TIMEOUT':
      return 504
    case 'INTERNAL_SERVER_ERROR':
    default:
      return 500
  }
}
