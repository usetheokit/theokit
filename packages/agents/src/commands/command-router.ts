/**
 * M83 — the command routing MECHANISM, and only that.
 *
 * ## Scope, stated before the code
 *
 * A consumer's terminal surface is 8 639 LOC. Most of it is chrome and widgets and belongs to
 * `@theokit/ui` / `@theokit/tui`. What has no counterpart anywhere is this: a registry, longest-prefix
 * routing, and the interpreter shape.
 *
 * What is deliberately NOT here (Top-risk 1 of the milestone): help rendering, aliases, completions.
 * Each of those is a mini CLI framework growing inside the agents package, and each needs its own ADR
 * with demand behind it. The ~50 command NAMES stay in the product; only the routing crosses.
 *
 * ## Longest prefix, not first match
 *
 * A terminal accepts `/model` and `/model-list`. Under first-match, whichever was registered first
 * swallows the other — `/model-list` routes to `model` with the argument `-list` — and the report
 * reads "my command stopped working", long after the registration order changed. Length is a property
 * of the names; position is an accident of the array.
 */

/** How a command treats the text after its name. */
export type CommandArgument = 'none' | 'optional' | 'required'

/** One routable command. The NAME is the contract: it is what the user types and what logs record. */
export interface CommandDefinition {
  readonly name: string
  readonly description: string
  /** Omitted ⇒ `'optional'`, the shape that refuses nothing. */
  readonly arg: CommandArgument
}

/** Declare a command. A function rather than an object literal so the default is stated once. */
export function defineCommand(input: {
  name: string
  description: string
  arg?: CommandArgument
}): CommandDefinition {
  return { name: input.name, description: input.description, arg: input.arg ?? 'optional' }
}

/** Why an input could not be routed. */
export type RouteFailure =
  | 'unknown-command'
  | 'missing-argument'
  | 'unexpected-argument'
  | 'ambiguous-command'

/** What the input turned out to be. */
export type RoutedInput =
  | { readonly kind: 'command'; readonly command: CommandDefinition; readonly arg: string }
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'error'; readonly reason: RouteFailure; readonly input: string }

const PREFIX = '/'

/**
 * Route one line of terminal input.
 *
 * Plain text is a MESSAGE, not an unknown command: a terminal that answered "unknown command" to
 * ordinary prose would be unusable. A leading `/` is an explicit claim to be a command, so an
 * unrecognised one is an ERROR rather than prose — sending `/moddel gpt-5` to the model as text
 * hides a typo behind a plausible answer.
 */
export function routeCommand(input: string, commands: readonly CommandDefinition[]): RoutedInput {
  if (!input.startsWith(PREFIX)) return { kind: 'message', text: input }

  const body = input.slice(PREFIX.length)

  // Longest first, so a name can never be swallowed by its own prefix. Ties are resolved after the
  // match, where the ambiguity can be REPORTED rather than silently decided.
  const byLength = [...commands].sort((a, b) => b.name.length - a.name.length)
  const matches = byLength.filter((command) => matchesName(body, command.name))
  // Guarded by LENGTH rather than by `matches[0] === undefined`: without
  // `noUncheckedIndexedAccess`, indexing an empty array is typed as present, so the compiler calls
  // the undefined-check impossible while the runtime value is exactly that. Checking the length is
  // the same guard in a form the type system agrees with.
  if (matches.length === 0) return { kind: 'error', reason: 'unknown-command', input }
  const best = matches[0]

  // Two commands of the SAME name — a custom one from `.theokit/commands/` shadowing a builtin. Same
  // posture as the M76 loader: this layer reports the collision and does not choose, because only
  // the product knows what its builtins do.
  if (matches.length > 1 && matches[1].name.length === best.name.length) {
    return { kind: 'error', reason: 'ambiguous-command', input }
  }

  const arg = body.slice(best.name.length).trim()
  if (arg !== '' && best.arg === 'none') {
    // `/clear everything` is a user who believes the word did something. Dropping it silently makes
    // the terminal look like it obeyed.
    return { kind: 'error', reason: 'unexpected-argument', input }
  }
  if (arg === '' && best.arg === 'required') {
    return { kind: 'error', reason: 'missing-argument', input }
  }
  return { kind: 'command', command: best, arg }
}

/**
 * Whether `body` invokes `name`.
 *
 * The name must be followed by a boundary — end of input or whitespace. Without that, `/modelx`
 * would route to `model` with the argument `x`, which is the same swallowing bug one level down.
 */
function matchesName(body: string, name: string): boolean {
  if (!body.startsWith(name)) return false
  const next = body.charAt(name.length)
  return next === '' || next === ' ' || next === '\t'
}
