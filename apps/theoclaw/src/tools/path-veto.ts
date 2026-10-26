import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { Plugin, PreToolCallContext } from '@theokit/sdk'

import { describeError } from '../control-plane/errors.js'
import type { ToolSettings } from './tool-settings.js'

/** The workspace directories the SDK and TheoClaw keep their state in. */
const STATE_DIRECTORIES = ['.theokit', '.theoclaw'] as const

/** The `apply_patch` headers that name a file the patch writes, moves or deletes. */
// `[^\n]*`, not `.*`: the patch parser splits lines on `\n` only, and `.` stops at U+2028.
const PATCH_DESTINATION = /^\*\*\* (?:Add File|Update File|Delete File|Move to): ([^\n]*)/gm

/** Symlinks followed before a path is refused as unresolvable, as the kernel's own limit. */
const MAX_SYMLINK_HOPS = 40

type Verdict = { readonly block: true; readonly message: string } | undefined

class MalformedArgument extends Error {}

function refuse(message: string): Verdict {
  return { block: true, message: `theoclaw: ${message}` }
}

function lexists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * `path` with its nearest existing ancestor replaced by that ancestor's real path, so a symlink is
 * followed. A dangling symlink counts as existing (`lstat`), and its target is followed the same
 * way, so a link the shell planted towards a state file that does not exist yet is still seen.
 */
function realPathOf(path: string, hops = 0): string {
  if (hops > MAX_SYMLINK_HOPS) throw new MalformedArgument(`${path} goes through more than ${MAX_SYMLINK_HOPS} symlinks`)
  let existing = path
  const rest: string[] = []
  while (!lexists(existing) && dirname(existing) !== existing) {
    rest.unshift(basename(existing))
    existing = dirname(existing)
  }
  try {
    return join(realpathSync(existing), ...rest)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // `existing` is a dangling symlink: follow its target.
    return realPathOf(join(resolve(dirname(existing), readlinkSync(existing)), ...rest), hops + 1)
  }
}

/** Case-folded, so `.THEOCLAW` is refused on a case-insensitive filesystem (APFS) too. */
function within(path: string, directory: string): boolean {
  const offset = relative(directory.toLowerCase(), path.toLowerCase())
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
}

function checkPath(value: unknown, settings: ToolSettings): Verdict {
  if (typeof value !== 'string' || value === '' || value.includes('\u0000')) {
    throw new MalformedArgument(`a path argument must be a non-empty string without a NUL byte`)
  }
  const real = realPathOf(resolve(settings.toolRoot, value))
  for (const state of STATE_DIRECTORIES) {
    if (within(real, join(settings.workspace, state))) return refuse(`${value} enters the workspace's ${state} directory`)
  }
  return undefined
}

function pathArguments(args: Record<string, unknown>): unknown[] {
  const found: unknown[] = []
  for (const key of ['path', 'file_path'] as const) {
    if (key in args) found.push(args[key])
  }
  if ('paths' in args) {
    if (!Array.isArray(args.paths)) throw new MalformedArgument('paths must be an array')
    found.push(...(args.paths as unknown[]))
  }
  return found
}

function patchDestinations(patch: unknown): string[] {
  if (typeof patch !== 'string') throw new MalformedArgument('patch must be a string')
  return [...patch.matchAll(PATCH_DESTINATION)].map((match) => (match[1] ?? '').trim())
}

/**
 * `git_diff` with a sandbox backend skips its own `.git` check, so with no path (or git pathspec
 * magic such as `:(top)x`) it diffs whatever repository git discovers above the tool root.
 */
function checkGitDiff(args: Record<string, unknown>): Verdict {
  const path = args.path
  if (typeof path !== 'string' || path === '' || path.startsWith(':')) {
    return refuse('git_diff needs a path inside the tool root, with no pathspec magic')
  }
  return undefined
}

function judge(context: PreToolCallContext, settings: ToolSettings): Verdict {
  const args = context.args
  if (typeof args !== 'object' || args === null) throw new MalformedArgument('the arguments are not an object')
  if (context.name === 'git_diff') {
    return checkGitDiff(args) ?? pathArguments(args).map((path) => checkPath(path, settings)).find(Boolean)
  }
  const candidates = context.name === 'apply_patch' ? patchDestinations(args.patch) : pathArguments(args)
  for (const candidate of candidates) {
    const verdict = checkPath(candidate, settings)
    if (verdict !== undefined) return verdict
  }
  return undefined
}

/**
 * A `pre_tool_call` veto that refuses, before the tool runs, a file path or an `apply_patch`
 * destination resolving (symlinks followed) into the workspace's `.theokit` or `.theoclaw`, and an
 * unscoped `git_diff` (plan D2, FR-006). The factories already confine paths to the tool root; this
 * guards the state they do not name. Every failure, a malformed argument included, becomes a block:
 * a `pre_tool_call` handler that throws escapes into the tool dispatch.
 */
export function pathVetoPlugin(settings: ToolSettings): Plugin {
  return {
    kind: 'general',
    name: 'theoclaw-path-veto',
    version: '1.0.0',
    register: (ctx) => {
      ctx.on('pre_tool_call', (context: unknown) => {
        try {
          return judge(context as PreToolCallContext, settings)
        } catch (error) {
          return refuse(`refused a malformed tool call: ${describeError(error)}`)
        }
      })
    },
  }
}
