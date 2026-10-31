import { chmodSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { dirname, join } from 'node:path'

import { createSandboxBackend, LinuxSandbox, resolveSandboxPosture, writableRootsFor } from '@theokit/agents/sandbox'
import type { BwrapDetection, SandboxBackend, SandboxMode } from '@theokit/agents/sandbox'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { readSandboxMode } from '../sandbox/sandbox-mode.js'
import { browserLine, readBrowser } from './browser-server.js'
import type { BrowserDeps, BrowserSettings } from './browser-server.js'
import { resolveExternalTools } from './external-tools.js'
import type { ExternalTools } from './external-tools.js'
import { isWithin, realPathOf, SymlinkLoopError } from './real-path.js'

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
  /** The backend's mode, which the tools are bound with: `sandboxMode` with host tools on, else `read-only`. */
  readonly mode: SandboxMode
  /** The mode the operator chose with `THEOCLAW_SANDBOX` (default `workspace-write`). */
  readonly sandboxMode: SandboxMode
  readonly fetchImpl: typeof fetch
  readonly search: SearchSettings
  /** The browser server's CLI with `THEOCLAW_BROWSER=on`; absent when the browser is off. */
  readonly browser?: BrowserSettings
  /** The MCP servers and ACP agents of `THEOCLAW_EXTERNAL_TOOLS`, for the `/control` agent only. */
  readonly external: ExternalTools
  /** Values the output mask must hide (the search keys, the external tools' header and env values). */
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
  /** The browser CLI resolver and browsers directory. Default: the installed package and Playwright's own. */
  readonly browser?: BrowserDeps
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

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

const SEARCH_OFF_LINE = 'tools: web search is off (no BRAVE_API_KEY or THEOKIT_SEARCH_API_URL)'
const SANDBOX_OFF_LINE = 'sandbox: off (danger-full-access), shell_exec runs unconfined'

/**
 * Brave when `BRAVE_API_KEY` is set (it wins over the generic adapter); the generic adapter when
 * both `THEOKIT_SEARCH_API_URL` and `THEOKIT_SEARCH_API_KEY` are; one of those two alone is refused
 * naming the other; neither is off. A blank value counts as unset.
 */
function readSearch(env: Env): SearchSettings {
  const brave = nonBlank(env.BRAVE_API_KEY)
  if (brave !== undefined) return { kind: 'brave', key: brave }
  const url = nonBlank(env.THEOKIT_SEARCH_API_URL)
  const key = nonBlank(env.THEOKIT_SEARCH_API_KEY)
  if (url !== undefined && key !== undefined) return { kind: 'generic', url, key }
  if (url !== undefined || key !== undefined) {
    const missing = url === undefined ? 'THEOKIT_SEARCH_API_URL' : 'THEOKIT_SEARCH_API_KEY'
    const present = url === undefined ? 'THEOKIT_SEARCH_API_KEY' : 'THEOKIT_SEARCH_API_URL'
    throw new TheoClawConfigError(`${present} is set without ${missing}; set both or neither`, { variable: missing })
  }
  return { kind: 'off' }
}

/**
 * Read the tool settings from the environment and the working directory, before any runner
 * starts. Throws `TheoClawConfigError` for a bad `THEOCLAW_HOST_TOOLS`, a bad `THEOCLAW_SANDBOX` (with
 * host tools off too), a bad tool root, or a `THEOCLAW_BROWSER=on` the host cannot run. Builds the
 * process's one sandbox backend: `read-only` with host tools off, the mode `THEOCLAW_SANDBOX` chose
 * with them on.
 */
export function resolveToolSettings(env: Env, cwd: string, deps: ToolDeps = {}): ToolSettings {
  const hostTools = readHostTools(env)
  const sandboxMode = readSandboxMode(env)
  const search = readSearch(env)
  const browser = readBrowser(env, deps.browser)
  const external = resolveExternalTools(env)
  if (hostTools && external.acpAgents.length > 0) {
    // An ACP agent runs unsandboxed in the tool root, one new process per call: with the shell able
    // to write there, a steered turn plants what the next call loads (a project settings file, a
    // relative argument, `node_modules/.bin`) outside the sandbox.
    throw new TheoClawConfigError(
      'THEOCLAW_EXTERNAL_TOOLS names ACP agents, which THEOCLAW_HOST_TOOLS=on refuses: the sandboxed shell can write files/, where each agent runs unsandboxed',
      { variable: 'THEOCLAW_EXTERNAL_TOOLS' },
    )
  }
  const workspace = realpathSync(cwd)
  const { toolRoot, lines } = prepareToolRoot(workspace)
  const mode: SandboxMode = hostTools ? sandboxMode : 'read-only'
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
  if (search.kind === 'off') offLines.push(SEARCH_OFF_LINE)
  if (mode === 'danger-full-access') offLines.push(SANDBOX_OFF_LINE)
  offLines.push(browserLine(browser))
  return {
    workspace,
    toolRoot,
    hostTools,
    gitRepository,
    sandboxEnforced,
    sandbox,
    mode,
    sandboxMode,
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    search,
    browser,
    external,
    // Every search key set, the unused one too: a key is a secret whether or not it is chosen.
    secrets: [
      ...[env.BRAVE_API_KEY, env.THEOKIT_SEARCH_API_KEY].flatMap((value) => nonBlank(value) ?? []),
      ...external.secrets,
    ],
    offLines,
  }
}

function realPathOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path
    throw error
  }
}

/** A directory whose contents the shell must not rewrite, named by the variable that set it. */
export interface ProtectedPath {
  readonly path: string
  readonly variable: string
}

/**
 * With host tools on, refuse a start the sandbox cannot make safe, unless the operator chose
 * `danger-full-access`, where the shell is unconfined by choice and nothing below holds: a backend
 * that is not a `LinuxSandbox` (the shell would run unconfined); a workspace inside a root the
 * `workspace-write` sandbox also leaves writable (`/tmp`), where the shell could rewrite
 * `.theokit/settings.json`, whose hooks the SDK runs outside the sandbox on the next agent; or any
 * of `protectedPaths` inside any root the shell can write, the tool root included. The caller names
 * every protected path, an empty list included, so none can be left out by omission.
 */
export function checkHostToolsPosture(
  settings: ToolSettings,
  protectedPaths: readonly ProtectedPath[],
  deps: ToolDeps = {},
): void {
  if (!settings.hostTools || settings.sandboxMode === 'danger-full-access') return
  if (!settings.sandboxEnforced) {
    const { sandboxMode } = settings
    const { detail } = resolveSandboxPosture({ mode: sandboxMode, ...(deps.detect === undefined ? {} : { detect: deps.detect }) })
    throw new TheoClawConfigError(
      `THEOCLAW_HOST_TOOLS=on needs an enforced sandbox (THEOCLAW_SANDBOX=${sandboxMode}): ${detail}; set THEOCLAW_SANDBOX=danger-full-access to run the shell unconfined`,
      { variable: 'THEOCLAW_SANDBOX' },
    )
  }
  // The `workspace-write` roots under `read-only` too: `read-only`'s are none, which would make the
  // refusals below vacuous; `danger-full-access` returned above, its roots being every path.
  const roots = writableRootsFor('workspace-write', settings.toolRoot) ?? []
  for (const root of roots) {
    // The workspace is a real path, so the root is compared as one too: bwrap binds what a
    // symlinked `/tmp` points at.
    if (root === settings.toolRoot || !isWithin(settings.workspace, realPathOrSelf(root))) continue
    throw new TheoClawConfigError(
      `THEOCLAW_HOST_TOOLS=on refuses the workspace ${settings.workspace}: it lies under ${root}, which the sandboxed shell can write`,
      { variable: 'THEOCLAW_HOST_TOOLS' },
    )
  }
  for (const target of protectedPaths) refuseWritableProtectedPath(target, roots)
}

/** Refuse a protected path whose real path (symlinks followed) lies inside any of `roots`. */
function refuseWritableProtectedPath({ path, variable }: ProtectedPath, roots: readonly string[]): void {
  let real: string
  try {
    real = realPathOf(path)
  } catch (error) {
    if (!(error instanceof SymlinkLoopError)) throw error
    throw new TheoClawConfigError(`THEOCLAW_HOST_TOOLS=on refuses ${variable} ${path}: ${error.message}`, { variable })
  }
  const root = roots.find((candidate) => isWithin(real, realPathOrSelf(candidate)))
  if (root === undefined) return
  throw new TheoClawConfigError(
    `THEOCLAW_HOST_TOOLS=on refuses ${variable} ${path}: it lies under ${root}, which the sandboxed shell can write`,
    { variable },
  )
}
