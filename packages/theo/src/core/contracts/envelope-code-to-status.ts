/**
 * Maps a TheoErrorEnvelope `code` to its canonical HTTP status.
 *
 * Single source of truth — previously duplicated in `web-handler.ts` and
 * `handle-request-error.ts` (architecture-remediation plan T1.2, 2026-06-12).
 *
 * Every TheoErrorCode value MUST have an explicit entry here. SDK-domain codes
 * (AGENT_RUN_ERROR, PROVIDER_KEY_MISSING, BUDGET_EXCEEDED, CREDENTIAL_POOL_EXHAUSTED)
 * intentionally map to 500 — they represent internal failures, not client errors.
 */

const CODE_TO_STATUS: Record<string, number> = {
  // 4xx — client errors
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  RATE_LIMITED: 429,

  // 5xx — server errors
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,

  // SDK-domain codes — intentionally 500
  AGENT_RUN_ERROR: 500,
  PROVIDER_KEY_MISSING: 500,
  BUDGET_EXCEEDED: 500,
  CREDENTIAL_POOL_EXHAUSTED: 500,
}

export function envelopeCodeToStatus(code: string): number {
  return CODE_TO_STATUS[code] ?? 500
}
