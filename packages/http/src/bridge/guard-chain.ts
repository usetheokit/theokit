/**
 * The guard pipeline, once, for every dispatcher (usetheokit/theokit#612).
 *
 * `@theokit/http` has three controller dispatchers over the same `WalkResult` — `TheoApp`
 * (`app.ts`), `createDecoratorHandler` (`bridge/create-server.ts`) and the TheoKit plugin
 * (`theokit-plugin.ts`) — and each carried its own copy of "run the guards, refuse on false".
 * #576 is the cost of that arrangement written down: a gate shipped into one copy, the framework's
 * own controller dispatch reused a different one, and a route could be refused by the build and
 * served by the runtime.
 *
 * ## What a refusal may say
 *
 * `CanActivate` returns a boolean, so a guard can express "no" and nothing else. That is the right
 * shape for "you are not signed in" and the wrong one for "you are allowed, later": a rate limiter
 * knows the status is 429, knows when the caller may return, and had no way to say either. Both
 * came out as `403 Forbidden resource`, which tells a well-behaved client to stop retrying forever
 * and gives a badly behaved one nothing to back off on.
 *
 * A guard that needs to say more throws an `HttpException` — `TooManyRequestsException`,
 * `UnauthorizedException` with a `WWW-Authenticate`, whatever the case is. This module lets it
 * propagate rather than catching it, so the dispatcher's own exception filters (`@UseFilters`) get
 * their turn; every dispatcher already renders `HttpException` through `httpExceptionToResponse`,
 * which carries the headers.
 *
 * A guard that throws anything else has FAILED, not decided. It propagates untouched, and becomes
 * a 500. Catching it into `false` would report an unreachable session store as "this caller is not
 * signed in" — safe-looking, silent, and wrong, which is the swallowed-exception pattern the error
 * handling rules forbid.
 */
import { ForbiddenException } from '../exceptions/http-exception.js'
import { httpExceptionToResponse } from '../exceptions/to-response.js'

import type { ExecutionContext, CanActivate } from './execution-context.js'

/**
 * How a guard class becomes a guard instance.
 *
 * Injected because the dispatchers disagree, and the disagreement is legitimate:
 * `createDecoratorHandler` and the plugin resolve through the DI container when there is one, and
 * `TheoApp` constructs directly. Taking it as a parameter is what let one pipeline serve all three
 * without the DI-aware ones losing DI.
 */
export type GuardResolver = (Ctor: Function) => CanActivate

/** Construct with `new`. The default for dispatchers with no container. */
const constructGuard: GuardResolver = (Ctor) => new (Ctor as new () => CanActivate)()

/**
 * Run every guard in order and produce the refusal, or `null` when all of them admit the caller.
 *
 * @param guards guard classes from the route's `WalkResult`
 * @param context the execution context handed to each `canActivate`
 * @param resolve how to instantiate a guard class; defaults to `new Ctor()`
 * @returns the `Response` to send instead of invoking the handler, or `null` to proceed
 * @throws whatever a guard throws — an `HttpException` for a refusal that needs a status of its
 *   own, anything else for a genuine fault
 */
export async function runGuards(
  guards: readonly Function[],
  context: ExecutionContext,
  resolve: GuardResolver = constructGuard,
): Promise<Response | null> {
  for (const GuardCtor of guards) {
    const guard = resolve(GuardCtor)
    if (!(await guard.canActivate(context))) {
      return httpExceptionToResponse(new ForbiddenException('Forbidden resource'))
    }
  }
  return null
}
