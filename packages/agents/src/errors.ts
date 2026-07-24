/**
 * Typed authoring failures for `@theokit/agents`.
 *
 * This module is still the leaf all internal layers import (`bridge/` + `capability/` both throw the
 * same typed error; keeping it here avoids the import cycle a home in `capability/capabilities.ts`
 * would close — `rules/architecture.md` § 2).
 *
 * M61 — there is now ONE `ConfigurationError`, not two. The layer used to define its own
 * (`extends Error`) while the SDK shipped a separate `ConfigurationError extends TheokitAgentError`;
 * the agent-builder imported the SDK's, so a `catch (e instanceof ConfigurationError)` caught one
 * path and silently missed the other. The layer now RE-EXPORTS the SDK's class, so authoring throws
 * from `@theokit/agents` and runtime throws from `@theokit/sdk` are the SAME class — `instanceof`
 * holds across the boundary in both directions. It gains the SDK's `{ code, cause, metadata }`
 * options (existing single-arg `new ConfigurationError('msg')` calls are unchanged — options are
 * optional) and stays `instanceof Error` (via `TheokitAgentError extends Error`). Decision in
 * `knowledge-base/adrs/0006-configuration-error-unification.md`.
 */
export { ConfigurationError } from '@theokit/sdk/errors'
