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
 * least privilege a property of the PIPELINE rather than of the system. Anything reaching the
 * dispatcher without having run that build is served, and `@theokit/http` is published on its own,
 * so "without having run that build" is an ordinary way to use it.
 *
 * Agent routes had neither. They are auto-wired — the app never wrote them, so there is no file for
 * a reviewer to read — dispatched BEFORE controllers and file routes, and covered by no gate at
 * all. An agent authored through capabilities has no class, so it takes no `@UseGuards`, so
 * `guards` was `undefined`, so `?? []`, so served.
 *
 * The fix is not a new guard. It is making absence REPRESENTABLE, so a decision can be told from
 * its residue.
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
 * `'warn'` is the default and serves the request after saying so once, loudly, at mount. `'deny'`
 * refuses with 403.
 *
 * The default is `'warn'` and not `'deny'` because flipping it silently would break every app whose
 * agent endpoints are open today — which is precisely the population #576 is about, and breaking
 * them inside a patch is how a security improvement becomes an outage. It becomes `'deny'` in the
 * next major; `'deny'` is available now for anyone who wants the property before then.
 */
export type UndeclaredRoutePolicy = 'warn' | 'deny'

/**
 * Classify one route from what its author declared.
 *
 * `access` is the explicit answer and wins. Otherwise a non-empty `guards` IS a declaration — the
 * author named who decides — and an empty or absent one is nobody having said.
 */
export function classifyAccess(declared: {
  access?: Exclude<AccessDecision, 'undeclared'>
  guards?: readonly unknown[]
}): AccessDecision {
  if (declared.access !== undefined) return declared.access
  return declared.guards !== undefined && declared.guards.length > 0 ? 'guarded' : 'undeclared'
}

/**
 * The line printed once per undeclared route, at mount.
 *
 * At mount and not per request: an operator reads the boot log, and a warning that only appears
 * under traffic is one that appears when it is too late to act on it. It names the route, because a
 * warning that does not say WHICH route sends the reader grepping.
 */
export function undeclaredRouteWarning(kind: 'agent' | 'controller', route: string): string {
  return (
    `[theokit] ${kind} route ${route} declares no access decision and is served to anyone. ` +
    `Declare one: attach a guard, or say it is open on purpose ` +
    `(${kind === 'agent' ? "`access: 'public'`" : '`@Public()`'}). ` +
    `This becomes a 403 in the next major; set \`undeclaredRoutes: 'deny'\` to refuse it now.`
  )
}
