import { resolve } from 'node:path'

import type { Plugin, PreToolCallContext } from '@theokit/sdk'

import { isWithin, resolveRealPath } from './real-path.js'
import type { ToolScope } from './tool-scope.js'

/** The `apply_patch` headers that name a file the patch writes, moves or deletes. */
// `[^\n]*`, not `.*`: the patch parser splits lines on `\n` only, and `.` stops at U+2028.
const PATCH_DESTINATION = /^\*\*\* (?:Add File|Update File|Delete File|Move to): ([^\n]*)/gm

const DEFAULT_PATH_KEYS: readonly string[] = ['path', 'file_path', 'filename', 'paths']

interface VetoOptions {
  readonly pathKeys?: readonly string[]
  readonly caseFold?: boolean
}

class MalformedArgument extends Error {}

function checkPath(value: unknown, scope: ToolScope, caseFold: boolean): string | undefined {
  if (typeof value !== 'string' || value === '' || value.includes('\u0000')) {
    throw new MalformedArgument('a path argument must be a non-empty string without a NUL byte')
  }
  const real = resolveRealPath(resolve(scope.projectRoot, value))
  for (const protectedPath of scope.protectedPaths) {
    // The protected directory is resolved too, so a symlinked protected directory is covered.
    if (isWithin(real, resolveRealPath(protectedPath), { caseFold })) {
      return `${value} enters the protected path ${protectedPath}`
    }
  }
  return undefined
}

function pathArguments(args: Record<string, unknown>, keys: readonly string[]): unknown[] {
  const found: unknown[] = []
  for (const key of keys) {
    if (!(key in args)) continue
    if (key === 'paths') {
      if (!Array.isArray(args[key])) throw new MalformedArgument('paths must be an array')
      found.push(...(args[key] as unknown[]))
    } else {
      found.push(args[key])
    }
  }
  return found
}

function patchDestinations(patch: unknown): string[] {
  if (typeof patch !== 'string') throw new MalformedArgument('patch must be a string')
  return [...patch.matchAll(PATCH_DESTINATION)].map((match) => (match[1] ?? '').trim())
}

function judge(
  scope: ToolScope,
  name: string,
  rawArgs: unknown,
  options: VetoOptions,
): string | undefined {
  if (typeof rawArgs !== 'object' || rawArgs === null) {
    throw new MalformedArgument('the arguments are not an object')
  }
  const args = rawArgs as Record<string, unknown>
  const caseFold = options.caseFold ?? true
  const keys = options.pathKeys ?? DEFAULT_PATH_KEYS
  if (name === 'git_diff') {
    // With a sandbox backend git_diff skips its own `.git` check, so with no path (or pathspec
    // magic such as `:(top)x`) it diffs whatever repository git finds above the root.
    const path = args.path
    if (typeof path !== 'string' || path === '' || path.startsWith(':')) {
      return 'git_diff needs a path inside the tool root, with no pathspec magic'
    }
  }
  const candidates =
    name === 'apply_patch' ? patchDestinations(args.patch) : pathArguments(args, keys)
  for (const candidate of candidates) {
    const verdict = checkPath(candidate, scope, caseFold)
    if (verdict !== undefined) return verdict
  }
  return undefined
}

function verdictOf(scope: ToolScope, name: string, args: unknown, options: VetoOptions): string {
  try {
    const message = judge(scope, name, args, options)
    return message === undefined ? '' : `path veto: ${message}`
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return `path veto: refused a malformed tool call: ${reason}`
  }
}

/**
 * The veto's verdict for one tool call: the refusal message, or `undefined` when the call may run.
 * Never throws; a malformed argument or an unresolvable path is a refusal. Use it for calls that
 * skip the plugin chain.
 */
export function vetoPathCall(scope: ToolScope, name: string, args: unknown): string | undefined {
  return verdictOf(scope, name, args, {}) || undefined
}

/**
 * A `pre_tool_call` plugin that refuses, before the tool runs, a file path or an `apply_patch`
 * destination resolving (symlinks followed) into one of the scope's `protectedPaths`, and an
 * unscoped `git_diff`. Every failure becomes a block, never a throw.
 */
export function createPathVetoPlugin(scope: ToolScope, options: VetoOptions = {}): Plugin {
  return {
    kind: 'general',
    name: 'theokit-path-veto',
    version: '1.0.0',
    register: (ctx) => {
      ctx.on('pre_tool_call', (context: unknown) => {
        const call = (context ?? {}) as Partial<PreToolCallContext>
        const message = verdictOf(scope, String(call.name), call.args, options)
        return message === '' ? undefined : { block: true, message }
      })
    },
  }
}
