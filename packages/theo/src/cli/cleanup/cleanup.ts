/**
 * State cleanup utilities (Phase 2 of
 *
 * - `cleanOutDir` — Astro pattern: empty a directory except a skip list,
 *   used at `theokit build` start.
 * - `gcAgentRegistry` — Nuxt LRU pattern: delete oldest agent dirs when
 *   count exceeds cap, used at `theokit dev` startup.
 *
 * EC-3 (MUST FIX, CRITICAL): cleanOutDir refuses to wipe anything outside
 *   the current cwd. Prevents catastrophic `distDir: '/'` data loss.
 * EC-9 (SHOULD TEST): gcAgentRegistry handles dirs with mtime=0 (Docker overlay).
 * EC-11 (SHOULD TEST): cleanOutDir normalizes trailing-slash in skip basenames.
 * EC-12 (SHOULD TEST): cleanOutDir catches EROFS and continues.
 */

import { promises as fs } from 'node:fs'
import { basename, resolve as resolvePath, sep } from 'node:path'

import type {
  CleanOutDirOptions,
  CleanOutDirResult,
  GcAgentRegistryOptions,
  GcAgentRegistryResult,
} from './cleanup-types.js'

const DEFAULT_SKIP = ['.git', '.gitkeep', '.gitignore']
// DEFAULT_MAX_AGENTS removed in Phase 7 — gcAgentRegistry is a tombstone.

/**
 * `.theokit/` holds two unrelated things: what `theokit build` writes (the default `distDir`), and
 * the agent context the framework and `@theokit/sdk` read at runtime. These lists name the second
 * kind so the build stops deleting it (#1079) and the generated ignore files can tell the two apart
 * (#1075, #1069).
 */

/**
 * Entries a person writes and the project versions and ships: the instruction file, rules,
 * personalities, skills, sub-agents, slash commands and hooks.
 *
 * `packages/create-theokit/templates/default/_gitignore` un-ignores the same names; a test keeps
 * the two in step, because create-theokit cannot import from this package.
 */
export const AUTHORED_AGENT_CONTEXT = [
  'THEO.md',
  'rules',
  'personalities',
  'skills',
  'agents',
  'commands',
  'hooks.json',
] as const

/**
 * Entries the agent runtime or a single developer writes: memory, local overrides, credentials,
 * trust and approval records, plugin bundles. A build keeps them; git and the image leave them out,
 * since several hold tokens.
 */
const LOCAL_AGENT_STATE = [
  'THEO.local.md',
  'AGENTS.local.md',
  'memory',
  'context',
  'context.json',
  'config.json',
  'settings.json',
  'mcp.json',
  'hooks',
  'plugins',
  'cron',
  'profiles',
  'auth.json',
  'mcp-tokens.json',
  'credential-pool.json',
  'tool-permissions.json',
  'hook-approvals.json',
] as const

function normalizeSkipName(name: string): string {
  // EC-11 — strip trailing slash + leading `./`
  return basename(name.replace(/\/$/, ''))
}

/**
 * Empty a directory, preserving entries in the skip list.
 *
 * Throws if `opts.dir` is not inside `process.cwd()` (EC-3 path safety).
 * Returns `{deleted:0, kept:0}` when the directory does not exist.
 */
export async function cleanOutDir(opts: CleanOutDirOptions): Promise<CleanOutDirResult> {
  const resolvedDir = resolvePath(opts.dir)
  const resolvedCwd = resolvePath(process.cwd())

  // EC-3 — path safety guard. CRITICAL.
  if (resolvedDir === resolvedCwd) {
    throw new Error(
      `cleanOutDir refused to wipe ${resolvedDir} — must be a child of cwd, not cwd itself`,
    )
  }
  if (!resolvedDir.startsWith(resolvedCwd + sep)) {
    throw new Error(
      `cleanOutDir refused to wipe ${resolvedDir} — must be inside cwd (${resolvedCwd})`,
    )
  }

  const skip = new Set((opts.skip ?? DEFAULT_SKIP).map(normalizeSkipName))

  let entries: { name: string }[]
  try {
    entries = await fs.readdir(resolvedDir, { withFileTypes: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { deleted: 0, kept: 0 }
    throw err
  }

  let deleted = 0
  let kept = 0
  for (const entry of entries) {
    const name = entry.name
    if (skip.has(name)) {
      kept++
      continue
    }
    const fullPath = resolvePath(resolvedDir, name)
    try {
      await fs.rm(fullPath, { recursive: true, force: true, maxRetries: 3 })
      deleted++
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        deleted++ // already gone
        continue
      }
      // EC-12 — EROFS or other rm failure: warn + continue, don't crash.
      console.warn(
        `[theokit] cleanOutDir could not remove ${fullPath} (${code ?? 'unknown'}); skipping`,
      )
      kept++
    }
  }

  return { deleted, kept }
}

/**
 * Phase 7 — TOMBSTONE for backward-compat. The SDK v1.1.0's `Agent.registry`
 * handles GC natively; this function is a no-op + emits a deprecation warning
 * ONCE per process (EC-10).
 *
 * Will be deleted entirely in TheoKit 0.4.0. Marked deprecated via runtime
 * warning rather than `@deprecated` JSDoc tag to avoid the eslint
 * sonarjs/deprecation flagging our own internal symbols.
 */
let warnedOnce = false
export async function gcAgentRegistry(
  _opts: GcAgentRegistryOptions,
): Promise<GcAgentRegistryResult> {
  if (!warnedOnce) {
    warnedOnce = true
    console.warn(
      '[theokit] gcAgentRegistry is deprecated; SDK Agent.registry handles GC natively (configure via theo.config.ts > agents.registry)',
    )
  }
  return Promise.resolve({ deleted: 0, kept: 0 })
}

/**
 * @internal — testing helper. Resets the module-scoped warnedOnce flag.
 */
export function __resetGcDeprecationWarnedForTests(): void {
  warnedOnce = false
}

/**
 * Empty the build output directory before `theokit build` writes into it, keeping the agent context
 * and local agent state that share `.theokit/` with the build output. Emptying it whole deleted the
 * scaffold's THEO.md, rules and personalities on the first build (#1079).
 */
export async function cleanBuildOutput(distDir: string): Promise<CleanOutDirResult> {
  return cleanOutDir({
    dir: distDir,
    skip: [...DEFAULT_SKIP, ...AUTHORED_AGENT_CONTEXT, ...LOCAL_AGENT_STATE],
  })
}
