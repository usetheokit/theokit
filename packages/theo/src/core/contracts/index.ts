/**
 * core/contracts/ — canonical home for shared client↔server contracts.
 *
 * Per ADR-0001 v3 invariant #3: this directory is the EXCEPTION to the
 * `no-cross-module-deep-import` rule. Any module may import directly from
 * `core/contracts/<file>.js`.
 *
 * This barrel exists for convenience. Consumers may use it OR import the
 * specific file — both are legal.
 */

export type { RouteConfig } from './route-config.js'
export type { RouteNode } from './route-node.js'

// Action protocol (G3 / T0.1). Types separated from runtime so type-only
// consumers tree-shake the classes out.
export type {
  ActionErrorCode,
  ActionManifestEntry,
  ActionResult,
  SerializedActionResult,
  UniversalZodIssue,
} from './action-protocol.js'
export {
  ActionError,
  ActionInputError,
  extractUniversalIssues,
  isActionError,
  isInputError,
} from './action-protocol.js'

// Error envelope (G5 / T1.1). Form 4 Hybrid — shared CODE enum + per-domain
// extensions + 2-layer SDK boundary translation per blueprint ADR D1+D3.
export type {
  TheoErrorCode,
  TheoErrorEnvelope,
  ValidationFieldsExt,
  RetryableExt,
  HintExt,
} from './error-envelope.js'
export { RETRYABLE_CODES, isRetryable } from './error-envelope.js'

// TheoError helper class (G5 / T1.2). Envelope-emitting Error subclass mirroring
// trpc's TRPCError ergonomic pattern; carries cause chain (TC39) + auto-strips
// meta.stack in non-dev (ADR D5). `fromUnknown` coerces any thrown value.
export type { TheoErrorOptions } from './theo-error.js'
export { TheoError, fromUnknown } from './theo-error.js'

// Server-side boundary translation (G5 / T2.5). Maps ad-hoc Error class
// names (AuthRequiredError, FileTooLargeError, RouterConventionError, etc.)
// to canonical TheoErrorEnvelope at the wire boundary. Single translation
// point preserves class identity inside the codebase (no invasive
// call-site rewrites).
export { serverErrorToEnvelope } from './server-error-to-envelope.js'

// Envelope code → HTTP status mapping (architecture-remediation T1.2).
// Single source of truth — previously duplicated in web-handler.ts and
// handle-request-error.ts.
export { envelopeCodeToStatus } from './envelope-code-to-status.js'

// Auth error guard (architecture-remediation T1.3). Shape-based detection
// without class import — preserves core INVARIANT 1.
export { isAuthRequiredError } from './auth-error-guard.js'
