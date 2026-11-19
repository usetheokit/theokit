import { createPtyOwner } from '@theokit/agents-pty'
import type { OwnedPtyBackend } from '@theokit/agents-pty'
import type { PtyInteractiveBackendOptions } from '@theokit/agents-pty'
import { interactiveWrapCommand } from '@theokit/agents/sandbox'
import type { InteractiveWrapOptions, SandboxMode } from '@theokit/agents/sandbox'
import { MORE_PERMISSIVE } from '../config/security-floor.js'

export interface SessionPtyOwner {
  backend(): OwnedPtyBackend
  setMode(mode: SandboxMode): void
  rotate(): void
  shutdown(): void
}

export const MAX_PTY_SESSIONS = 16

export interface SessionPtyOwnerOptions {
  initialMode: SandboxMode
  maxSessions: number
  createWrap?: (opts: InteractiveWrapOptions) => (command: string, cwd: string) => string | null
  createBackend?: (opts: PtyInteractiveBackendOptions) => OwnedPtyBackend
}

/**
 * TheoCode's wiring of the framework PTY owner: the shared most-confined-first ordering from the
 * config security floor (B-014: tightening the sandbox ends live sessions, loosening does not) and
 * the sandbox wrap per mode. The ownership mechanics live in `@theokit/agents-pty`.
 */
export function createSessionPtyOwner(opts: SessionPtyOwnerOptions): SessionPtyOwner {
  const createWrap = opts.createWrap ?? interactiveWrapCommand
  const owner = createPtyOwner<SandboxMode>({
    mode: opts.initialMode,
    order: MORE_PERMISSIVE.sandbox_mode as readonly SandboxMode[],
    maxSessions: opts.maxSessions,
    wrapFor: (mode) => createWrap({ mode }),
    ...(opts.createBackend === undefined ? {} : { createBackend: opts.createBackend }),
  })
  return {
    backend: () => owner.backend(),
    setMode: (mode) => {
      owner.setMode(mode)
    },
    rotate: () => owner.rotate(),
    shutdown: () => owner.shutdown(),
  }
}
