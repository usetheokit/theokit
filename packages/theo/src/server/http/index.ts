// M7-1: public typed-error primitives for the convention server. TheoError /
// fromUnknown / NotFoundError / serverErrorToEnvelope / envelopeCodeToStatus
// live in core/contracts (the canonical shared-types home, importable directly
// per rules/architecture.md § Invariant 3) — surfaced via theokit/server/http.
export { fromUnknown, NotFoundError, TheoError } from '../../core/contracts/theo-error.js'
export { serverErrorToEnvelope } from '../../core/contracts/server-error-to-envelope.js'
export { envelopeCodeToStatus } from '../../core/contracts/envelope-code-to-status.js'
export { handleRequestError, handleWebRequestError } from './handle-request-error.js'
export * from './execute.js'
export * from './action-execute.js'
export * from './middleware-runner.js'
export * from './cors.js'
export * from './cookies.js'
export * from './batch-handler.js'
export * from './error-pages.js'
export * from './static.js'
export * from './trace-context.js'

// usetheokit/theokit#372 — the umbrella's deprecation says "use sub-paths", and these sixteen had
// none, so a consumer told to migrate before `0.x+2` had nowhere to go. They are HTTP-boundary
// symbols and this is the HTTP subpath, so the destination was never in doubt — the barrel was
// simply incomplete. `tests/smoke/umbrella-symbols-have-a-subpath.test.ts` asserts the general
// invariant so the next addition cannot arrive orphaned unnoticed.
//
// Named rather than `export *`: `web-handler.js` and `in-process-caller.js` carry internals this
// subpath has no reason to publish, and a star would make the public surface a side effect of an
// implementation file's shape.
export { executeWebRequest } from '../web-handler.js'
export { callProcedure, ProcedureInputError, ProcedureOutputError } from './in-process-caller.js'
export { validateRouteInput } from './validate-route-input.js'
export { parseRequestBody, FileTooLargeError } from '../body-parser.js'
export { jsonTransformer, superjsonTransformer, resolveTransformer } from '../transformer.js'
export { createOpenApiHandler } from '../openapi/serve-docs.js'
export {
  ActionError,
  ActionInputError,
  isActionError,
  isInputError,
  extractUniversalIssues,
} from '../../core/contracts/action-protocol.js'
