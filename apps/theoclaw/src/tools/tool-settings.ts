import { chmodSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { dirname, join } from 'node:path'

import { createSandboxBackend, LinuxSandbox, resolveSandboxPosture } from '@theokit/agents/sandbox'
import type { BwrapDetection, SandboxBackend, SandboxMode } from '@theokit/agents/sandbox'

import { TheoClawConfigError } from '../control-plane/errors.js'

/** Where web search goes, chosen from the keys present at start. */
export interface SearchSettings {
  readonly kind: 'brave' | 'generic' | 'off'
  readonly url?: string
  readonly key?: string
}

/** Everything the tool list is built from, resolved once at start. */
export interface ToolSettings {
  /** The real path of the process working directory, where the SDK keeps `.theokit`. */
  readonly workspace: string
  /** `<workspace>/files`: the project root and write root of every file tool. */
  readonly toolRoot: string
  readonly hostTools: boolean
  readonly gitRepository: boolean
  /** True when the one backend built at start is a kernel-confined `LinuxSandbox`. */
  readonly sandboxEnforced: boolean
  /** Built once at start; every agent's tools share it (plan D3, revision 1.2). */
  readonly sandbox: SandboxBackend
  readonly mode: SandboxMode
  readonly fetchImpl: typeof fetch
  readonly search: SearchSettings
  /** Values the output mask must hide (the search keys). */
  readonly secrets: readonly string[]
  /** One line each for what is off, or what the start changed, written at start. */
  readonly offLines: readonly string[]
}

/** What the tests inject; the process passes nothing. */
export interface ToolDeps {
  readonly detect?: () => BwrapDetection
  readonly fetchImpl?: typeof fetch
  /** Where the sandbox fallback warning goes. Default: the SDK's (`console.warn`). */
  readonly warn?: (message: string) => void
}

type Env = Readonly<Record<string, string | undefined>>

const TOOL_ROOT_MODE = 0o700

function readHostTools(env: Env): boolean {
  const value = env.THEOCLAW_HOST_TOOLS
  if (value === undefined || value === '') return false
  if (value === 'on') return true
  throw new TheoClawConfigError(`THEOCLAW_HOST_TOOLS must be "on" or unset, not "${value}"`, {
    variable: 'THEOCLAW_HOST_TOOLS',
  })
}

function lstatOrUndefined(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Create `<workspace>/files` with mode 0700, or check the one already there: a symlink, a
 * non-directory, or a directory whose real path is not directly under the workspace is refused;
 * a directory open to group or others is narrowed to 0700, and the returned line says so.
 */
function prepareToolRoot(workspace: string): { readonly toolRoot: string; readonly lines: string[] } {
  const toolRoot = join(workspace, 'files')
  const existing = lstatOrUndefined(toolRoot)
  if (existing === undefined) {
    mkdirSync(toolRoot, { mode: TOOL_ROOT_MODE })
    chmodSync(toolRoot, TOOL_ROOT_MODE)
    return { toolRoot, lines: [] }
  }
  if (existing.isSymbolicLink()) {
    throw new TheoClawConfigError(`the tool root ${toolRoot} is a symlink; it must be a directory inside the workspace`)
  }
  if (!existing.isDirectory()) {
    throw new TheoClawConfigError(`the tool root ${toolRoot} exists and is not a directory`)
  }
  // `workspace` is already a real path and a symlinked `files` was refused above, so this only
  // catches a parent swapped between the two checks.
  if (dirname(realpathSync(toolRoot)) !== workspace) {
    throw new TheoClawConfigError(`the tool root ${toolRoot} does not resolve to a directory directly under ${workspace}`)
  }
  if ((existing.mode & 0o077) === 0) return { toolRoot, lines: [] }
  try {
    chmodSync(toolRoot, TOOL_ROOT_MODE)
  } catch (error) {
    throw new TheoClawConfigError(
      `the tool root ${toolRoot} is open to other users and could not be narrowed to mode 0700: ${(error as Error).message}`,
    )
  }
  return { toolRoot, lines: [`tools: narrowed the tool root ${toolRoot} to mode 0700`] }
}

/** `.git/HEAD` a file, `.git/objects` and `.git/refs` directories, none of them a symlink. */
function isRepository(toolRoot: string): boolean {
  const git = join(toolRoot, '.git')
  return (
    lstatOrUndefined(git)?.isDirectory() === true &&
    lstatOrUndefined(join(git, 'HEAD'))?.isFile() === true &&
    lstatOrUndefined(join(git, 'objects'))?.isDirectory() === true &&
    lstatOrUndefined(join(git, 'refs'))?.isDirectory() === true
  )
}

/**
 * Read the tool settings from the environment and the working directory, before any runner
 * starts. Throws `TheoClawConfigError` for a bad `THEOCLAW_HOST_TOOLS` or a bad tool root. Builds
 * the process's one sandbox backend: `read-only` with host tools off, `workspace-write` with them on.
 */
export function resolveToolSettings(env: Env, cwd: string, deps: ToolDeps = {}): ToolSettings {
  const hostTools = readHostTools(env)
  const workspace = realpathSync(cwd)
  const { toolRoot, lines } = prepareToolRoot(workspace)
  const mode: SandboxMode = hostTools ? 'workspace-write' : 'read-only'
  const sandbox = createSandboxBackend({
    mode,
    workDir: toolRoot,
    ...(deps.detect === undefined ? {} : { detect: deps.detect }),
    ...(deps.warn === undefined ? {} : { warn: deps.warn }),
  })
  const sandboxEnforced = sandbox instanceof LinuxSandbox
  const gitRepository = isRepository(toolRoot)
  const offLines = [...lines]
  if (gitRepository && !sandboxEnforced) {
    const { detail } = resolveSandboxPosture({ mode, ...(deps.detect === undefined ? {} : { detect: deps.detect }) })
    offLines.push(`tools: git_diff is off (sandbox not enforced: ${detail})`)
  }
  return {
    workspace,
    toolRoot,
    hostTools,
    gitRepository,
    sandboxEnforced,
    sandbox,
    mode,
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    search: { kind: 'off' },
    secrets: [],
    offLines,
  }
}
