//
// `@Public()` — the access decision "anyone may call this", said as intent (usetheokit/theokit#574).
//
// ## Why this exists when `SetMetadata` already did
//
// Since #514 every controller route MUST declare an access decision or the build fails, so this sits
// on the critical path of every route an adopter writes. The two surfaces said the same thing very
// differently:
//
// | | route builder | controller |
// |---|---|---|
// | open route | `.policy('public')` | `@SetMetadata('theokit:public', true)` |
//
// One names the intent; the other hands over the framework's own metadata key as a string literal.
// Measured in the first real adopter: 8 controllers, 6 hand-written copies of that string.
//
// The recorded objection was parsimony — `SetMetadata` exists, so rung 4 ("a dependency is already
// installed → reuse it") forbids a second way. Rung 4 guards against pulling in another library; it
// says nothing about a named export in a package this project owns and which already exports 103.
// The rung that applies is rung 1, *does this need to exist?*, and the ladder answers it with the
// clause it never trades away: **security is never sacrificed for parsimony**. An access decision
// every consumer spells by hand, from a key they cannot import, is that clause's case.
//
// ## What it buys beyond typing less
//
// The key leaves consumer source. Today `'theokit:public'` is copied into every app that has a
// public controller route, so changing it means a coordinated edit across every app — which means
// it cannot change. Behind this decorator it is ours again.
//
// `SetMetadata` stays exported and stays supported. This does not close the door on the raw form,
// and it deliberately does NOT make controllers a second policy engine: `.policy()` on the route
// builder takes a predicate over a subject and remains the richer surface. This says only the most
// common of the two answers, which is the one being written by hand.
import { SetMetadata } from './set-metadata.js'

// The key was a `const` inside `cli/commands/build/emit-controllers.ts`, a module no entry point
// reaches — which is why the docs there had to instruct consumers to type the string, and why a
// rename would have needed a coordinated edit in every app that had one.
/**
 * The metadata key the framework reads to decide a controller route is open.
 *
 * @public
 */
export const PUBLIC_ROUTE_METADATA = 'theokit:public'

/**
 * Declare that a controller route may be called by anyone.
 *
 * ```ts
 * @Get()
 * @Public()
 * check() { return { status: 'ok' } }
 * ```
 *
 * The controller equivalent of `.policy('public')` on the route builder. `'public'` is a decision,
 * not the absence of one — the build refuses a controller route that declares neither. Use
 * `@SetMetadata`/`@UseGuards` for anything this does not say.
 *
 * @public
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE_METADATA, true)
