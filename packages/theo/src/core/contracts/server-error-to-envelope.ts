/**
 * G5 T2.5 — server-side boundary translation per blueprint ADR D3.
 *
 * Translates ad-hoc Error class instances (FileTooLargeError,
 * AuthRequiredError, RouterConventionError, etc.) into the canonical
 * `TheoErrorEnvelope` shape at the wire boundary. This is the SINGLE
 * boundary translation point — class identities stay in place inside the
 * codebase (no invasive call-site rewrites), but the envelope is what
 * crosses to clients.
 *
 * Pure; no I/O. Lives in `core/contracts/` per architecture.md v3
 * invariant #3 (canonical home for shared client↔server types). This file
 * is the EXCEPTION-of-an-exception: it intentionally inspects Error names
 * by string instead of `instanceof` to avoid `core/contracts/` taking a
 * dependency on `server/`. The mapping table is small and grep-discoverable.
 */

import type { TheoErrorCode, TheoErrorEnvelope } from './error-envelope.js'
import { TheoError } from './theo-error.js'

/**
 * Mapping from ad-hoc Error class name to envelope code. Add entries here
 * when a new ad-hoc Error is introduced anywhere in `theokit/server/`.
 * Build-time errors (Duplicate*, ActionScanError, InvalidPluginShapeError)
 * are NOT in this table by design — they never cross the wire boundary,
 * so their canonical shape is `INTERNAL_SERVER_ERROR` via the default branch.
 */
const ERROR_NAME_TO_CODE: ReadonlyMap<string, TheoErrorCode> = new Map<string, TheoErrorCode>([
  ['AuthRequiredError', 'UNAUTHORIZED'],
  ['FileTooLargeError', 'PAYLOAD_TOO_LARGE'],
  ['RequestBodyTooLargeError', 'PAYLOAD_TOO_LARGE'],
  ['BodyTooLargeError', 'PAYLOAD_TOO_LARGE'],
  // RouterConventionError reaches the wire only during dev-error overlay;
  // INTERNAL_SERVER_ERROR is appropriate, but we add a HintExt-shaped ext
  // with the migration guidance for the devtools display.
  ['RouterConventionError', 'INTERNAL_SERVER_ERROR'],

  // M80 — the agent errors, which this table contained NONE of.
  //
  // The consequence was concrete: a `GuardrailViolationError` — thrown when a prompt-injection or
  // PII guard BLOCKS — crossed as HTTP 500, indistinguishable from a real server failure. Retry
  // middleware then re-submitted the very input the guard had just rejected.
  //
  // The status codes say what actually happened: the request was refused (400), the caller has
  // spent its budget (429), or a human must approve before this proceeds (403). None of the three
  // is "the server broke", and none should be retried by a generic 5xx policy.
  ['GuardrailViolationError', 'BAD_REQUEST'],
  ['CostBudgetExceededError', 'TOO_MANY_REQUESTS'],
  ['InProcessApprovalRequiredError', 'FORBIDDEN'],
])

type MetaExtractor = (err: Error) => Record<string, unknown> | null

/**
 * Class-specific metadata extractors. Each function receives the raw Error
 * and returns an object merged into envelope.meta (excluding name/message
 * which are reserved).
 */
const META_EXTRACTORS: ReadonlyMap<string, MetaExtractor> = new Map<string, MetaExtractor>([
  [
    'FileTooLargeError',
    (err) => {
      const e = err as Error & { truncatedFilenames?: string[]; maxFileSize?: number }
      return {
        truncatedFilenames: e.truncatedFilenames ?? [],
        maxFileSize: e.maxFileSize,
      }
    },
  ],
  [
    'RouterConventionError',
    (err) => {
      const e = err as Error & { file?: string; suggestion?: string; migrationUrl?: string }
      return {
        file: e.file,
        suggestion: e.suggestion,
        migrationUrl: e.migrationUrl,
      }
    },
  ],
  [
    // M80 — so telemetry can count blocks PER GUARD without parsing the message. A count derived
    // from message text breaks the first time somebody improves the wording, and the improvement
    // looks harmless right up until the dashboard goes flat.
    //
    // Read from the class's own public fields rather than the SDK's `metadata`: that type is
    // provider-transport shaped (`provider`, `endpoint`, `statusCode`, `retryAfter`), and an
    // agent-domain fact does not belong in it.
    'GuardrailViolationError',
    (err) => {
      const e = err as Error & { guardName?: string; phase?: string }
      return { guardName: e.guardName, phase: e.phase }
    },
  ],
])

type ExtBuilder = (err: Error) => unknown

/**
 * Class-specific ext (extension slot) builders. RouterConventionError ships a
 * HintExt-shaped `{ hint }` so devtools / dev overlay can render the actionable
 * migration tip directly.
 */
const EXT_BUILDERS: ReadonlyMap<string, ExtBuilder> = new Map<string, ExtBuilder>([
  [
    'RouterConventionError',
    () => ({
      hint: 'Run `theokit migrate router` to convert dotted-basename routes to directory-nested form.',
    }),
  ],
])

/**
 * Translate any server-side Error instance into a canonical envelope.
 *
 * Pass-through behavior:
 * - `TheoError` instances return their `.envelope` unchanged.
 * - Plain `Error` with unknown name → `INTERNAL_SERVER_ERROR`.
 * - Non-Error values → wrapped via `TheoError.fromUnknown` semantics.
 *
 * Meta carries the source class `name` plus class-specific fields when an
 * extractor is registered. This keeps wire-side telemetry useful without
 * leaking implementation details.
 */
export function serverErrorToEnvelope(value: unknown): TheoErrorEnvelope {
  if (value instanceof TheoError) {
    return value.envelope
  }
  if (!(value instanceof Error)) {
    return {
      code: 'INTERNAL_SERVER_ERROR',
      message: typeof value === 'string' ? value : 'Unknown error',
    }
  }
  const name = value.name
  const code = ERROR_NAME_TO_CODE.get(name) ?? 'INTERNAL_SERVER_ERROR'
  const extractor = META_EXTRACTORS.get(name)
  const extra = extractor ? extractor(value) : null
  const meta: Record<string, unknown> = { name }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) meta[k] = v
    }
  }
  const extBuilder = EXT_BUILDERS.get(name)
  const ext = extBuilder ? extBuilder(value) : undefined
  return {
    code,
    message: value.message,
    cause: (value as Error & { cause?: unknown }).cause,
    meta,
    ext,
  }
}
