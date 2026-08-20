/**
 * Who is asking. Supplied by the caller through the run-context, never read from
 * a transport.
 *
 * A cookie is one way to establish this and a terminal has no cookies, so the
 * contract takes the resolved subject rather than the mechanism that resolved it
 * (ADR 0001 section Decision, point 4).
 */
export interface RouteSubject {
  id: string
  [claim: string]: unknown
}

/** The answer a policy gives. A denial carries its reason so the caller can say it. */
export type AccessDecision = { allowed: true } | { allowed: false; reason: string }

/** What a policy is handed. Deliberately transport-free: no headers, no cookies, no response. */
export interface RoutePolicyInput<TQuery = unknown, TBody = unknown, TParams = unknown> {
  subject: RouteSubject | null
  query: TQuery
  body: TBody
  params: TParams
}

/**
 * A route's access policy.
 *
 * `'public'` is a declaration, not a default. The point of writing it is that
 * openness becomes greppable — today a route that enforces nothing looks exactly
 * like a route nobody thought about (ADR 0001 section Consequences, Risks).
 */
export type RoutePolicy<TQuery = unknown, TBody = unknown, TParams = unknown> =
  | 'public'
  | ((
      input: RoutePolicyInput<TQuery, TBody, TParams>,
    ) => boolean | AccessDecision | Promise<boolean | AccessDecision>)

/** Narrow a run-context to the subject it carries, if it carries one. */
export function subjectFromContext(context: unknown): RouteSubject | null {
  if (context === null || typeof context !== 'object') return null
  const candidate = (context as { subject?: unknown }).subject
  if (candidate === null || candidate === undefined || typeof candidate !== 'object') return null
  const id = (candidate as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? (candidate as RouteSubject) : null
}

/**
 * Evaluate a route policy. THE single implementation - the HTTP executors and
 * the in-process caller all reach this function, which is what makes "the same
 * route gives the same access decision on every transport" a property of the code
 * rather than a claim in a document.
 *
 * The shape mirrors `validateRouteInput`, which is already described in-source as
 * "the SINGLE shared pipeline ... One pipeline, no drift". Access control had no
 * such pipeline; that absence is what ADR 0001 exists to close.
 *
 * An undeclared policy returns `allowed` and is NOT the same thing as `'public'`.
 * Absence is refused where an application DECLARES its routes — the file-system
 * scanner fails the build naming the file (`MissingRoutePolicyError`) — and not
 * here, where the argument may be a `RouteConfig` a caller built in memory and
 * never scanned. Reinterpreting absence as denial at this point would break
 * every direct caller of the executors at once, which the ADR routes through the
 * build gate and a migration instead.
 */
export async function evaluateRoutePolicy(
  policy: RoutePolicy | undefined,
  input: RoutePolicyInput,
): Promise<AccessDecision> {
  if (policy === undefined) return { allowed: true }
  if (policy === 'public') return { allowed: true }

  const verdict = await policy(input)
  if (typeof verdict === 'boolean') {
    return verdict ? { allowed: true } : { allowed: false, reason: 'access denied by route policy' }
  }
  return verdict
}

/**
 * The authorization primitive the framework did not have.
 *
 * `requireAuth` answers "is anyone there". Every action then answered "may THIS
 * subject touch THIS record" on its own, which is one implementation per action
 * and one place per action to get it wrong. This is that answer, once.
 */
export function requireOwner(
  subject: RouteSubject | null,
  ownerId: string | null | undefined,
): AccessDecision {
  if (subject === null) return { allowed: false, reason: 'not authenticated' }
  if (typeof ownerId !== 'string' || ownerId.length === 0) {
    // An unowned resource is not an open one. A record whose owner is unknown is
    // a record no subject can be shown to own, and guessing here would fail open
    // on exactly the data whose ownership someone failed to record.
    return { allowed: false, reason: 'resource has no recorded owner' }
  }
  return subject.id === ownerId
    ? { allowed: true }
    : { allowed: false, reason: 'subject does not own this resource' }
}
