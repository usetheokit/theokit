/* eslint-disable security/detect-non-literal-fs-filename --
 * A loader that reads `.theokit/commands/` from directories the caller names. The variable filename
 * IS the feature. No HTTP input reaches here — the paths come from the framework's own convention
 * resolution, and the project directory is gated on the M68/M73 trust decision.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

import { frontmatterValue, splitFrontmatter } from './frontmatter.js'

/**
 * M76 — load custom commands from `.theokit/commands/`.
 *
 * ## Why this gap was worse than a missing feature
 *
 * The framework OWNS the `.theokit/` convention and already loads `skills/`, `agents/` and
 * `hooks.json` from it. `commands/` — the one directory every product-facing agent surface wants —
 * had no loader at all. So a consumer wrote markdown-with-frontmatter scanning **against the
 * framework's own directory**: reimplementing the reading of a convention the framework defines.
 *
 * A convention with a hole in it is worse than no convention. It teaches the reader that `.theokit/`
 * is the framework's, then makes them write the loader themselves for one subdirectory, and their
 * loader inevitably disagrees with ours about frontmatter, precedence and trust.
 *
 * ## Trust, and why project commands are gated
 *
 * A command is a prompt the user can invoke by name. A project-level one comes from the working
 * directory — which, for an agent pointed at a repository the user just cloned, is
 * attacker-controlled content. Same decision as M68: `projectTrusted` false means project commands
 * do not load. User-level commands under `homeDir` need no gate — that is the operator's own
 * machine.
 *
 * ## Warns, never decides
 *
 * On a name collision this loader REPORTS and moves on. Which command wins when a custom one shadows
 * a builtin is the product's router to decide (M83) — it is the only layer that knows what its
 * builtins are. A loader that silently dropped one would make that decision invisibly, on behalf of
 * a product it cannot see.
 */

/** One command loaded from disk. */
export interface CustomCommand {
  /** Invocation name, derived from the file name without its extension. */
  readonly name: string
  /** One-line summary from `description:` in the frontmatter, when present. */
  readonly description?: string
  /** The prompt body, frontmatter removed. */
  readonly body: string
  /** Which layer it came from. `project` beats `user` — see {@link loadCustomCommands}. */
  readonly source: 'project' | 'user'
  /** Absolute path, for messages a human can act on. */
  readonly path: string
}

export interface LoadCustomCommandsInput {
  /** Project root. Its `.theokit/commands/` is read only when `projectTrusted`. */
  readonly projectDir?: string
  /** Operator home. Its `.theokit/commands/` needs no trust gate. */
  readonly homeDir?: string
  /**
   * Whether the project directory is trusted (M68/M73).
   *
   * REQUIRED, like `approved` on the hook engine and for the same reason: an optional security gate
   * is a gate somebody forgets, and forgetting this one loads prompts written by whoever wrote the
   * repository.
   */
  readonly projectTrusted: boolean
  /** Names the product already uses, so a shadow can be reported rather than discovered later. */
  readonly builtinNames?: readonly string[]
  /** Where a shadow, a duplicate, or a malformed file is reported. */
  readonly onWarn?: (message: string) => void
}

export interface CustomCommandsResult {
  /** Loaded commands, project-level first. Names are unique — see the precedence note. */
  readonly commands: readonly CustomCommand[]
  /** Names that also exist as builtins. Reported, never resolved here. */
  readonly shadowedBuiltins: readonly string[]
}

const COMMANDS_DIR = join('.theokit', 'commands')
const IGNORE_WARNING = (): void => undefined

/**
 * Load `.theokit/commands/*.md` from the project and the user, project winning.
 *
 * Precedence is project-over-user because the project is the more specific scope: a repository that
 * ships a `review` command means *its* review, and having the operator's generic one silently take
 * precedence would make the repository's own configuration the weaker statement.
 */
export function loadCustomCommands(input: LoadCustomCommandsInput): CustomCommandsResult {
  const warn = input.onWarn ?? IGNORE_WARNING
  const loaded = new Map<string, CustomCommand>()

  // User first, project second: the later write wins the map, which is the precedence.
  if (input.homeDir !== undefined) {
    for (const command of readCommandsDir(join(input.homeDir, COMMANDS_DIR), 'user', warn)) {
      loaded.set(command.name, command)
    }
  }

  if (input.projectDir !== undefined) {
    if (!input.projectTrusted) {
      const pending = readCommandsDir(
        join(input.projectDir, COMMANDS_DIR),
        'project',
        IGNORE_WARNING,
      )
      if (pending.length > 0) {
        warn(
          `${String(pending.length)} project command(s) found but the directory is not trusted — ` +
            `none were loaded. A command is a prompt that runs on your behalf.`,
        )
      }
    } else {
      for (const command of readCommandsDir(
        join(input.projectDir, COMMANDS_DIR),
        'project',
        warn,
      )) {
        const shadowed = loaded.get(command.name)
        if (shadowed !== undefined) {
          warn(
            `project command "${command.name}" overrides the user-level one at ${shadowed.path}.`,
          )
        }
        loaded.set(command.name, command)
      }
    }
  }

  const builtins = new Set(input.builtinNames ?? [])
  const shadowedBuiltins = [...loaded.keys()].filter((name) => builtins.has(name))
  for (const name of shadowedBuiltins) {
    warn(
      `custom command "${name}" has the same name as a builtin. This loader does not choose ` +
        `between them — the router decides, because only it knows what its builtins do.`,
    )
  }

  return {
    // Project first in the returned order, matching the precedence a reader would expect.
    commands: [...loaded.values()].sort(byProjectThenName),
    shadowedBuiltins,
  }
}

/** Project before user, then alphabetical — the order the precedence rule implies. */
function byProjectThenName(a: CustomCommand, b: CustomCommand): number {
  if (a.source !== b.source) return a.source === 'project' ? -1 : 1
  return a.name.localeCompare(b.name)
}

/** Read one commands directory. A missing one is not an error — it is a machine with no commands. */
function readCommandsDir(
  dir: string,
  source: CustomCommand['source'],
  warn: (message: string) => void,
): CustomCommand[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  // Sorted so the load order is the same on every machine — `readdir` order is filesystem-defined,
  // and a warning that appears in a different order per run is a warning nobody can diff. Sorting
  // in place is safe: `entries` is the array `readdirSync` just minted for us, held by nobody else.
  entries.sort((a, b) => a.localeCompare(b))

  const commands: CustomCommand[] = []
  for (const entry of entries) {
    if (extname(entry) !== '.md') continue
    const path = join(dir, entry)
    try {
      if (!statSync(path).isFile()) continue
    } catch {
      continue // vanished between readdir and stat
    }

    const command = parseCommandFile(path, entry, source, warn)
    if (command !== undefined) commands.push(command)
  }
  return commands
}

/**
 * Parse one command file.
 *
 * A file whose frontmatter never closes is SKIPPED with a warning, exactly as the instruction tree
 * does: one malformed file must not disable every command the user wrote.
 */
function parseCommandFile(
  path: string,
  entry: string,
  source: CustomCommand['source'],
  warn: (message: string) => void,
): CustomCommand | undefined {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }

  const parsed = splitFrontmatter(raw)
  if (parsed === undefined) {
    warn(`command frontmatter never closes, file skipped: ${path}`)
    return undefined
  }

  const description = frontmatterValue(parsed.frontmatter, 'description')
  return {
    name: basename(entry, '.md'),
    ...(description !== undefined && { description }),
    body: parsed.body,
    source,
    path,
  }
}
