/**
 * Whether a route DECLARED an access decision, or nobody said (usetheokit/theokit#576).
 *
 * ## The ambiguity this removes
 *
 * `guards: []` meant two different things and the dispatcher could not tell them apart:
 *
 * - *this route is open on purpose*, and
 * - *nobody said*.
 *
 * Faced with both readings it took the permissive one and served. For controllers that was safe
 * only because a separate build gate (#514) refuses an undeclared controller route — which makes
 * least privilege a property of the PIPELINE rather than of the system. Anything reaching a
 * dispatcher without having run that build is served, and `@theokit/http` is published on its own,
 * so "without having run that build" is an ordinary way to use it.
 *
 * Agent routes had neither. They are auto-wired — the app never wrote them, so there is no file for
 * a reviewer to read — dispatched BEFORE controllers and file routes, and covered by no gate at
 * all. An agent authored through capabilities has no class, so it takes no `@UseGuards`, so
 * `guards` was `undefined`, so `?? []`, so served.
 *
 * The fix is not a new guard. It is making absence REPRESENTABLE, so a decision can be told from
 * its residue — and then REFUSING it, so the property belongs to the system rather than to
 * whichever command happened to run the build gate.
 */

/** What a route says about who may call it. */
export type AccessDecision =
  /** Anyone may call it, on purpose. */
  | 'public'
  /** At least one guard decides. */
  | 'guarded'
  /** Nobody said — the state that used to be indistinguishable from `'public'`. */
  | 'undeclared'

/**
 * How an app answers a route that declared nothing.
 *
 * `'deny'` is the default and refuses with 403. `'warn'` serves the request after saying so once,
 * loudly, at the first dispatch — the migration escape, and nothing else.
 *
 * The default was `'warn'` for one release, so that flipping it did not break every app whose
 * agent endpoints were open, inside a patch. It is `'deny'` from `@theokit/http@2.0.0`, which is
 * the major that release bought: a safe default an app has to switch on is not a safe default, and
 * the population that never reads the warning is exactly the population #576 is about.
 */
export type UndeclaredRoutePolicy = 'warn' | 'deny'

/**
 * Classify one route from what its author declared.
 *
 * `access` is the explicit answer and wins. Otherwise a NON-EMPTY `guards` IS a declaration — the
 * author named who decides — and an empty or absent one is nobody having said.
 *
 * "Non-empty" and not "present" is deliberate, and it is the one place this can drift from the
 * build gate: `@UseGuards()` with no arguments writes `[]`, which reads as a declaration to anyone
 * skimming the file and decides nothing at dispatch. Both gates refuse it (#576).
 */
export function classifyAccess(declared: {
  access?: Exclude<AccessDecision, 'undeclared'>
  guards?: readonly unknown[]
}): AccessDecision {
  if (declared.access !== undefined) return declared.access
  return declared.guards !== undefined && declared.guards.length > 0 ? 'guarded' : 'undeclared'
}

/** How a route says it is open, in the surface the author is holding. */
const declareOpen = (kind: 'agent' | 'controller'): string =>
  kind === 'agent' ? "`access: 'public'`" : '`@Public()`'

/**
 * The line printed once per undeclared route that is nonetheless served.
 *
 * Only reachable under an explicit `undeclaredRoutes: 'warn'`, which is the whole point: the
 * default refuses, and an app that opted back into being served is told what it opted into. It
 * names the route, because a warning that does not say WHICH route sends the reader grepping.
 */
export function undeclaredRouteWarning(kind: 'agent' | 'controller', route: string): string {
  return (
    `[theokit] ${kind} route ${route} declares no access decision and is served to anyone ` +
    `because \`undeclaredRoutes: 'warn'\` is set. Declare one: attach a guard, or say it is open ` +
    `on purpose (${declareOpen(kind)}). Dropping the option refuses it with 403.`
  )
}

/**
 * The 403 body for a route nobody declared.
 *
 * Separate from a guard REFUSING a caller, which is the system working, and it must read that way:
 * an operator meeting this has a route to fix, not a caller to authenticate. It names both
 * declarations and the escape, so the fix does not require finding this file.
 */
export function undeclaredRouteRefusal(kind: 'agent' | 'controller', route: string): string {
  return (
    `${kind === 'agent' ? 'Agent' : 'Controller'} route ${route} declares no access decision, ` +
    `so it is refused. Attach a guard, or say it is open on purpose (${declareOpen(kind)}). ` +
    `\`undeclaredRoutes: 'warn'\` serves it with a warning while you migrate.`
  )
}
