import { join, resolve } from 'node:path'

import type { Plugin, PreToolCallContext } from '@theokit/sdk'

import { describeError } from '../control-plane/errors.js'
import { isWithin, realPathOf } from './real-path.js'
import type { ToolSettings } from './tool-settings.js'

/** The workspace directories the SDK and TheoClaw keep their state in. */
const STATE_DIRECTORIES = ['.theokit', '.theoclaw'] as const

/** The `apply_patch` headers that name a file the patch writes, moves or deletes. */
// `[^\n]*`, not `.*`: the patch parser splits lines on `\n` only, and `.` stops at U+2028.
const PATCH_DESTINATION = /^\*\*\* (?:Add File|Update File|Delete File|Move to): ([^\n]*)/gm

type Verdict = { readonly block: true; readonly message: string } | undefined

class MalformedArgument extends Error {}

function refuse(message: string): Verdict {
  return { block: true, message: `theoclaw: ${message}` }
}

function checkPath(value: unknown, settings: ToolSettings): Verdict {
  if (typeof value !== 'string' || value === '' || value.includes('\u0000')) {
    throw new MalformedArgument(`a path argument must be a non-empty string without a NUL byte`)
  }
  const real = realPathOf(resolve(settings.toolRoot, value))
  for (const state of STATE_DIRECTORIES) {
    // Case-folded, so `.THEOCLAW` is refused on a case-insensitive filesystem (APFS) too.
    if (isWithin(real, join(settings.workspace, state), { caseFold: true })) return refuse(`${value} enters the workspace's ${state} directory`)
  }
  return undefined
}

function pathArguments(args: Record<string, unknown>): unknown[] {
  const found: unknown[] = []
  // `filename`: the browser server's file tools name the file they write or read with it. The server
  // resolves a relative one against its own temp directory, not the tool root, so for `mcp_browser_*`
  // the veto's real guard is an absolute filename; a relative one is refused as defence in depth.
  for (const key of ['path', 'file_path', 'filename'] as const) {
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

function judge(name: string, rawArgs: unknown, settings: ToolSettings): Verdict {
  if (typeof rawArgs !== 'object' || rawArgs === null) throw new MalformedArgument('the arguments are not an object')
  const args = rawArgs as Record<string, unknown>
  if (name === 'git_diff') {
    return checkGitDiff(args) ?? pathArguments(args).map((path) => checkPath(path, settings)).find(Boolean)
  }
  const candidates = name === 'apply_patch' ? patchDestinations(args.patch) : pathArguments(args)
  for (const candidate of candidates) {
    const verdict = checkPath(candidate, settings)
    if (verdict !== undefined) return verdict
  }
  return undefined
}

/** The veto's verdict, malformed arguments included; every failure is a refusal, never a throw. */
function verdictOf(name: string, args: unknown, settings: ToolSettings): Verdict {
  try {
    return judge(name, args, settings)
  } catch (error) {
    return refuse(`refused a malformed tool call: ${describeError(error)}`)
  }
}

/**
 * The veto for one tool call made outside the SDK's dispatch: the refusal message, or `undefined`
 * when the call may run. A script's `api` call runs the tool's handler directly and skips the
 * `pre_tool_call` plugins, so `run_code`'s permission gate asks this instead (plan D3); the plugin
 * below asks the same function, so both give one verdict for one call.
 */
export function vetoToolCall(name: string, args: unknown, settings: ToolSettings): string | undefined {
  return verdictOf(name, args, settings)?.message
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
        // A missing context reads as missing arguments, which the veto refuses as malformed.
        const call = (context ?? {}) as Partial<PreToolCallContext>
        return verdictOf(String(call.name), call.args, settings)
      })
    },
  }
}
