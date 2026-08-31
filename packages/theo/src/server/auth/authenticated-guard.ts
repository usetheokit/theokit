/**
 * `Authenticated(sessions)` — "any signed-in caller", said once by the framework instead of
 * hand-written in every app (usetheokit/theokit#574).
 *
 * ## What this replaces
 *
 * Since #514 every controller route MUST declare an access decision, and since #576 a route that
 * declares nothing is refused at dispatch. So the two most common answers sit on the critical path
 * of every route an adopter writes:
 *
 * | | route builder | controller, before this |
 * |---|---|---|
 * | open route | `.policy('public')` | `@Public()` (shipped in #574's first half) |
 * | any signed-in caller | `.policy(({ subject }) => subject !== null)` | write your own guard class |
 *
 * The second row was the whole issue. Measured in the first real adopter: 8 controllers, 6 copies
 * of a 22-line `AuthGuard`, and the docblock on that class is the evidence for why it belongs here:
 *
 * > An earlier version read `subjectFromContext` off the execution context — that context carries
 * > `getRequest`, `getUrl`, `getClass` and `getMethodName` and nothing else, so the lookup returned
 * > `undefined` and the guard denied EVERYONE. It passed the only test aimed at it, because that
 * > test checked that an unauthenticated request is refused.
 *
 * A guard that always denies is indistinguishable from a working one until somebody tries to get
 * in. `subjectFromContext` now throws on that shape rather than answering `null`, which turns the
 * silent version into a loud one — but the remaining half of the fix is not making the wrong guard
 * fail louder, it is not making every adopter write the guard at all. `parsimony-ladder.md` is
 * explicit that security is the one thing the ladder never trims.
 *
 * ## Why it lives in `theokit` and not in `@theokit/http`
 *
 * The issue asked for it from `@theokit/http`, and it cannot be there: `theokit` depends on
 * `@theokit/http`, never the reverse, and this guard has to know what a session IS. A guard shipped
 * from the HTTP package could only take a resolver — which is the callback an app would have had to
 * write correctly anyway, so it would move the hazard rather than remove it.
 *
 * `theokit/server/auth` is where `createSessionManagerWeb` already lives, so an adopter wiring this
 * is importing from a module they already have open.
 *
 * ## What it deliberately does NOT do
 *
 * It answers "is anyone there", never "may THIS subject touch THIS record". That second question is
 * `requireOwner` from `theokit/server/define`, and conflating them is how an app ends up believing
 * an authenticated stranger is an authorised one. `@UseGuards` and `@SetMetadata` stay exported for
 * anything this does not say.
 */
import type { CanActivate, ExecutionContext } from '@theokit/http'

/**
 * The half of a session manager this needs.
 *
 * Structural and minimal on purpose: `SessionManagerWeb` satisfies it, and so does a test double or
 * an app that reads its session from somewhere else entirely. Asking for the full interface would
 * force a caller to own four methods this never calls.
 */
export interface SessionReader<TSession> {
  getSession(request: Request): Promise<TSession | null>
}

/**
 * A guard admitting any caller that carries a valid session.
 *
 * ```ts
 * import { createSessionManagerWeb, Authenticated } from 'theokit/server/auth'
 *
 * const sessions = createSessionManagerWeb<{ userId: string }>({ secret: process.env.SESSION_SECRET! })
 *
 * @Controller('api/tasks')
 * @UseGuards(Authenticated(sessions))
 * export class TasksController {
 *   @Get() list() { return [] }
 * }
 * ```
 *
 * Returns a CLASS, because `@UseGuards` takes constructors and instantiates one per request — the
 * session manager travels in the closure rather than through a container, so this works with or
 * without DI.
 *
 * A `getSession` that THROWS propagates, and is not caught into `false`. A thrown error is a fault
 * in the session layer, not an access decision, and turning it into a denial would report a broken
 * secret or an unreachable store as "this caller is not signed in" — the swallowed-exception
 * pattern `error-handling.md` § 2 forbids. Denying happens to be the safe direction, which is
 * exactly why it would go unnoticed.
 *
 * @param sessions the session manager the app already built; its `getSession` reads the request
 * @returns a guard class ready to pass to `@UseGuards`
 */
export function Authenticated<TSession>(sessions: SessionReader<TSession>): new () => CanActivate {
  return class AuthenticatedGuard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      // `context.getRequest()`, never `subjectFromContext(context)`. The second is the mistake this
      // guard exists to stop an app from making: an ExecutionContext carries no subject.
      return (await sessions.getSession(context.getRequest())) !== null
    }
  }
}
