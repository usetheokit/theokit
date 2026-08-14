/**
 * `@theokit/agents/commands` — M83: terminal command routing and orderly shutdown.
 *
 * A subpath, by the rule the M76 and M82 bundle findings established: an app that only defines an
 * agent should not pay for machinery a TERMINAL surface needs. The main barrel sits close enough to
 * its ceiling that every addition has to earn the bytes, and these two do not belong to an HTTP app.
 *
 * ## What is here, and what is deliberately not
 *
 * Here: the registry, longest-prefix routing, the interpreter shape, and the shutdown watchdog.
 *
 * NOT here (Top-risk 1 of the milestone): help rendering, aliases, completions — each a mini CLI
 * framework growing inside the agents package. Nor argument PARSING, which ADR 0042 puts out of
 * scope with its reasons: a terminal router reads a line a human typed mid-session; an `argv` parser
 * reads the process's launch, and that domain already has `node:util`'s `parseArgs`.
 */
export { defineCommand, routeCommand } from './command-router.js'
export type {
  CommandArgument,
  CommandDefinition,
  RouteFailure,
  RoutedInput,
} from './command-router.js'

export { createShutdown, DEFAULT_WATCHDOG_MS, SHUTDOWN_EXIT_CODES } from './shutdown.js'
export type { CleanupTask, Shutdown, ShutdownDeps, ShutdownOutcome } from './shutdown.js'
