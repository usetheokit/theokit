import { ConfigurationError } from '@theokit/agents'
import { createPtyOwner } from '@theokit/agents-pty'
import type { OwnedPtyBackend, PtyInteractiveBackendOptions } from '@theokit/agents-pty'
import { interactiveWrapCommand } from '@theokit/agents/sandbox'
import type { InteractiveWrapOptions, SandboxMode } from '@theokit/agents/sandbox'
import { MORE_PERMISSIVE } from '../config/security-floor.js'

type BackendComPosse = OwnedPtyBackend

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

/**
 * The app owner over the framework's `createPtyOwner`.
 *
 * `wrapCommand` reads the mode at call time, so a NEW command always runs under the current
 * confinement, but a process already spawned keeps the wrap it started with. The framework owner
 * therefore ends live sessions when the mode TIGHTENS and leaves them alone when it loosens (B-014).
 * The ordering is the config security floor's, so both agree on what "tighter" means.
 */
export function createSessionPtyOwner(opts: SessionPtyOwnerOptions): SessionPtyOwner {
  const { initialMode, maxSessions } = opts
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new ConfigurationError(
      `maxSessions must be an integer >= 1 (received: ${String(maxSessions)})`,
      { code: 'max_sessions_invalid' },
    )
  }
  const createWrap = opts.createWrap ?? interactiveWrapCommand
  const owner = createPtyOwner<SandboxMode>({
    mode: initialMode,
    order: MORE_PERMISSIVE.sandbox_mode as readonly SandboxMode[],
    maxSessions,
    wrapFor: (mode) => createWrap({ mode }),
    ...(opts.createBackend === undefined ? {} : { createBackend: opts.createBackend }),
  })
  return {
    backend: () => owner.backend(),
    setMode: (mode) => {
      owner.setMode(mode)
    },
    rotate: () => {
      owner.rotate()
    },
    shutdown: () => {
      owner.shutdown()
    },
  }
}
