import { ConfigurationError } from '@theokit/agents'
import type { InteractiveBackend } from '@theokit/agents/interactive'
import { PtyInteractiveBackend } from '@theokit/agents-pty'
import type { PtyInteractiveBackendOptions } from '@theokit/agents-pty'
import { interactiveWrapCommand } from '@theokit/agents/sandbox'
import type { InteractiveWrapOptions, SandboxMode } from '@theokit/agents/sandbox'
import { MORE_PERMISSIVE } from '../config/security-floor.js'

interface BackendComPosse extends InteractiveBackend {
  killAll(): void
  activeSessionCount(): number
}

export interface SessionPtyOwner {
  backend(): BackendComPosse
  setMode(mode: SandboxMode): void
  rotate(): void
  shutdown(): void
}

export const MAX_PTY_SESSIONS = 16

export interface SessionPtyOwnerOptions {
  initialMode: SandboxMode
  maxSessions: number
  createWrap?: (opts: InteractiveWrapOptions) => (command: string, cwd: string) => string | null
  createBackend?: (opts: PtyInteractiveBackendOptions) => BackendComPosse
}

/** Index in the shared most-confined-first ordering; -1 for an unknown mode. */
function permissiveness(mode: SandboxMode): number {
  return (MORE_PERMISSIVE.sandbox_mode as readonly string[]).indexOf(mode)
}

export function createSessionPtyOwner(opts: SessionPtyOwnerOptions): SessionPtyOwner {
  const { initialMode, maxSessions } = opts
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new ConfigurationError(
      `maxSessions must be an integer >= 1 (received: ${String(maxSessions)})`,
      { code: 'max_sessions_invalid' },
    )
  }

  const createWrap = opts.createWrap ?? interactiveWrapCommand
  const createBackend =
    opts.createBackend ?? ((o: PtyInteractiveBackendOptions) => new PtyInteractiveBackend(o))

  let currentMode: SandboxMode = initialMode

  const newBackend = (): BackendComPosse =>
    createBackend({
      wrapCommand: (command, cwd) => createWrap({ mode: currentMode })(command, cwd),
      maxSessions,
    })

  let current = newBackend()

  return {
    backend: () => current,
    setMode: (mode) => {
      // B-014 — `wrapCommand` reads the mode at call time, so a NEW command always runs under the
      // current confinement. A process already spawned does not: its wrap was fixed when it started.
      // So a `bash -i` launched under danger-full-access survived a switch to read-only, alive and
      // interactive under the permissive wrap.
      //
      // Tightening therefore ends live sessions; loosening does not. A session confined MORE than
      // the current mode is not a hazard, and killing the user's REPL to grant it more access would
      // be gratuitous. Reuses the permissiveness order the config security floor already defines.
      const tightening = permissiveness(mode) < permissiveness(currentMode)
      currentMode = mode
      if (tightening) {
        current.killAll()
        current = newBackend()
      }
    },
    rotate: () => {
      current.killAll()
      current = newBackend()
    },
    shutdown: () => {
      current.killAll()
    },
  }
}
