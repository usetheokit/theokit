import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { PtyInteractiveBackend } from '@theokit/agents-pty'
import { InteractiveBackend } from '@theokit/agents/interactive'
import type { StartInteractiveOptions, StartInteractiveResult, WriteStdinOptions, WriteStdinResult } from '@theokit/agents/interactive'
import { interactiveWrapCommand } from '@theokit/agents/sandbox'
import type { BwrapDetection } from '@theokit/agents/sandbox'

import type { ToolSettings } from './tool-settings.js'

/** The variables the confined shell keeps; the rest of the process environment (keys, tokens) is dropped. */
const KEPT_VARIABLES: readonly string[] = ['PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ']

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** `env -i` with the kept variables and `HOME` in the tool root, then the command in `sh -c`. */
function scrubbed(command: string, toolRoot: string, env: Readonly<Record<string, string | undefined>>): string {
  const kept = KEPT_VARIABLES.flatMap((name) => (env[name] === undefined ? [] : [`${name}=${quote(env[name])}`]))
  return `/usr/bin/env -i ${[...kept, `HOME=${quote(toolRoot)}`].join(' ')} /bin/sh -c ${quote(command)}`
}

/**
 * A PTY backend whose every session starts in the tool root, with a scrubbed environment, inside the
 * session's sandbox: `interactiveWrapCommand` of the settings' mode (bubblewrap on Linux). The PTY
 * would otherwise start in the process directory and hand the shell the whole environment.
 */
class ConfinedInteractiveBackend extends InteractiveBackend {
  private readonly inner: PtyInteractiveBackend

  constructor(
    private readonly toolRoot: string,
    settings: Pick<ToolSettings, 'mode'>,
    detect: (() => BwrapDetection) | undefined,
    warn: ((message: string) => void) | undefined,
    env: Readonly<Record<string, string | undefined>>,
  ) {
    super()
    const wrap = interactiveWrapCommand({
      mode: settings.mode,
      ...(detect === undefined ? {} : { detect }),
      ...(warn === undefined ? {} : { warn }),
    })
    this.inner = new PtyInteractiveBackend({
      maxSessions: 4,
      wrapCommand: (command, cwd) => wrap(scrubbed(command, toolRoot, env), cwd),
    })
  }

  startInteractive(command: string, opts?: StartInteractiveOptions): Promise<StartInteractiveResult> {
    return this.inner.startInteractive(command, { ...opts, cwd: this.toolRoot })
  }

  writeStdin(sessionId: string, chars: string, opts?: WriteStdinOptions): Promise<WriteStdinResult> {
    return this.inner.writeStdin(sessionId, chars, opts)
  }

  kill(sessionId: string): void {
    this.inner.kill(sessionId)
  }
}

export interface InteractiveDeps {
  readonly detect?: () => BwrapDetection
  readonly warn?: (message: string) => void
  /** The environment the shell's kept variables come from. Default: the process's. */
  readonly processEnv?: Readonly<Record<string, string | undefined>>
}

/** A confined backend for these settings. Not yet probed: see `probeInteractiveShell`. */
export function createConfinedInteractive(settings: ToolSettings, deps: InteractiveDeps = {}): InteractiveBackend {
  return new ConfinedInteractiveBackend(settings.toolRoot, settings, deps.detect, deps.warn, deps.processEnv ?? process.env)
}

/** Until `condition` holds, the session has exited, or the time is up; whether the condition holds. */
async function waitForSession(backend: InteractiveBackend, sessionId: string, condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    const { alive } = await backend.writeStdin(sessionId, '', { yieldMs: 250 })
    if (!alive) break
  }
  return condition()
}

/**
 * True when a session started through `backend` can write inside `<workspace>/files` and cannot
 * write beside it, in the workspace. Runs a real session; false on any failure (no `node-pty`, no
 * bubblewrap, a sandbox that confines too little or too much).
 */
export async function probeInteractiveShell(settings: ToolSettings, backend: InteractiveBackend): Promise<boolean> {
  const id = randomBytes(6).toString('hex')
  const inside = join(settings.toolRoot, `.probe-in-${id}`)
  const outside = join(settings.workspace, `.probe-out-${id}`)
  let session: string | undefined
  try {
    mkdirSync(settings.toolRoot, { recursive: true })
    const started = await backend.startInteractive(`sh -c 'touch ${quote(inside)}; touch ${quote(outside)}; sleep 1'`, { yieldMs: 250 })
    session = started.sessionId
    const wrote = await waitForSession(backend, started.sessionId, () => existsSync(inside), 3000)
    if (!wrote) return false
    // Give the second `touch` the time it would need had the sandbox allowed it.
    await new Promise((resolve) => setTimeout(resolve, 300))
    return wrote && !existsSync(outside)
  } catch {
    return false
  } finally {
    if (session !== undefined) backend.kill(session)
    rmSync(inside, { force: true })
    rmSync(outside, { force: true })
  }
}

/**
 * `settings` with the interactive shell, only when the probe passes on this host: host tools on, an
 * enforced sandbox, and a real session that writes in the tool root and nowhere else. Otherwise
 * `settings` itself with a line saying why the shell is off.
 */
export async function withInteractiveShell(settings: ToolSettings, deps: InteractiveDeps = {}): Promise<ToolSettings> {
  if (!settings.hostTools) return settings
  const off = (why: string): ToolSettings => ({ ...settings, offLines: [...settings.offLines, `tools: interactive_shell is off (${why})`] })
  if (!settings.sandboxEnforced) return off('sandbox not enforced')
  if (settings.backend === 'docker') return off('THEOCLAW_SANDBOX_BACKEND=docker has no interactive shell')
  const interactive = createConfinedInteractive(settings, deps)
  if (!(await probeInteractiveShell(settings, interactive))) {
    return off('no confined session could be proven on this host: needs node-pty and THEOCLAW_SANDBOX=workspace-write')
  }
  return { ...settings, interactive }
}
