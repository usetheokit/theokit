/**
 * `@theokit/agents/pty` — a stub that exists to explain where it went (#460, ADR 0004).
 *
 * The PTY backend moved to `@theokit/agents-pty`, because carrying `@theokit/sdk-pty` here made
 * every web application run a native install step for a terminal it would never open (6.7 s against
 * 1.4 s to install this package alone).
 *
 * ## Why a throwing stub and not a clean removal
 *
 * Removing the subpath outright gives an upgrading consumer `ERR_MODULE_NOT_FOUND` on a specifier
 * that worked yesterday, and nothing to search for. This keeps the specifier RESOLVING and spends
 * the failure on a sentence instead. It is still a breaking change — a throw is a break — but a
 * break that explains itself.
 *
 * It costs nothing it was meant to remove: no dependency, no native build, no import of
 * `@theokit/sdk-pty`. That is the whole point — a compatibility shim that re-added the dependency
 * would undo the change it is shimming.
 *
 * ## Why it throws at CALL and not at import
 *
 * A module-level `throw` fires on import, before any code runs, which would break a consumer that
 * merely re-exports this path without using it. Throwing from the members means the failure lands on
 * the line that actually needed the backend.
 */

const MIGRATION =
  '`@theokit/agents/pty` has moved to its own package.\n\n' +
  '  npm install @theokit/agents-pty\n\n' +
  "  - import { PtyInteractiveBackend } from '@theokit/agents/pty'\n" +
  "  + import { PtyInteractiveBackend } from '@theokit/agents-pty'\n\n" +
  'The surface is identical — the same six symbols, re-exported from `@theokit/sdk-pty` with no ' +
  'wrapper. It moved because its native install step was being paid by every application, including ' +
  'the ones that never open a terminal. See usetheokit/theokit#460.'

/** Every member of the old surface fails the same way, naming the same fix. */
function moved(symbol: string): never {
  throw new Error(`${symbol}: ${MIGRATION}`)
}

/** The Proxy target must be callable to allow `construct`/`apply` traps; it is never reached. */
function unreachable(): never {
  return moved('unreachable')
}

export const PtyInteractiveBackend = new Proxy(unreachable as unknown as never, {
  construct: () => moved('PtyInteractiveBackend'),
  apply: () => moved('PtyInteractiveBackend'),
  get: () => moved('PtyInteractiveBackend'),
})

export const MaxSessionsError = new Proxy(unreachable as unknown as never, {
  construct: () => moved('MaxSessionsError'),
  apply: () => moved('MaxSessionsError'),
  get: () => moved('MaxSessionsError'),
})

export function clampYield(): never {
  return moved('clampYield')
}

// Values, not functions, in the original surface — so a property READ has to be what fails. A plain
// number here would silently be the wrong number; a getter puts the message on the access.
export const YIELD_MIN_MS: number = Object.defineProperty({}, 'valueOf', {
  get: () => moved('YIELD_MIN_MS'),
}) as unknown as number

export const YIELD_MAX_MS: number = Object.defineProperty({}, 'valueOf', {
  get: () => moved('YIELD_MAX_MS'),
}) as unknown as number

/**
 * A type cannot throw, so it says it instead.
 *
 * The alias resolves to a string literal, which means `tsc` prints the migration in the error the
 * moment a consumer tries to use the old type — the compiler delivers the sentence the runtime stub
 * delivers for the values. `never` would have been the tidier alias and would have said nothing.
 */
export type PtyInteractiveBackendOptions =
  '`PtyInteractiveBackendOptions` moved to @theokit/agents-pty — npm install @theokit/agents-pty and import it from there (usetheokit/theokit#460)'
