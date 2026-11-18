import { PtyInteractiveBackend } from '@theokit/sdk-pty'
import type { PtyInteractiveBackendOptions } from '@theokit/sdk-pty'

/** The public members `PtyInteractiveBackend` already has, named structurally (no new dependency). */
type InteractiveBackendLike = { [K in keyof PtyInteractiveBackend]: PtyInteractiveBackend[K] }

export interface OwnedPtyBackend extends InteractiveBackendLike {
  killAll(): void
  activeSessionCount(): number
}

export interface PtyOwnerOptions<M extends string> {
  readonly mode: M
  /** Most confined first. Default: ['read-only', 'workspace-write', 'danger-full-access']. */
  readonly order?: readonly M[]
  readonly maxSessions: number
  /** Builds the wrap for a mode, e.g. (mode) => interactiveWrapCommand({ mode }) from @theokit/agents/sandbox. */
  readonly wrapFor: (mode: M) => (command: string, cwd: string) => string | null
  /** Test seam. */
  readonly createBackend?: (options: PtyInteractiveBackendOptions) => OwnedPtyBackend
}

export interface PtyOwner<M extends string> {
  backend(): OwnedPtyBackend
  mode(): M
  /** `killed` is greater than zero only when the mode tightened. */
  setMode(mode: M): { readonly killed: number }
  rotate(): void
  shutdown(): void
}

export class PtyOwnerConfigError extends Error {
  readonly code = 'pty_owner_invalid'
  constructor(message: string) {
    super(message)
    this.name = 'PtyOwnerConfigError'
  }
}

const DEFAULT_ORDER = ['read-only', 'workspace-write', 'danger-full-access'] as const

export function createPtyOwner<M extends string>(options: PtyOwnerOptions<M>): PtyOwner<M> {
  const { maxSessions, wrapFor } = options
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new PtyOwnerConfigError(
      `maxSessions must be an integer >= 1 (received: ${String(maxSessions)})`,
    )
  }
  const order: readonly string[] = options.order ?? DEFAULT_ORDER
  const rank = (mode: M): number => {
    const index = order.indexOf(mode)
    if (index === -1) {
      throw new PtyOwnerConfigError(
        `mode ${JSON.stringify(mode)} is not in the order [${order.join(', ')}]`,
      )
    }
    return index
  }
  rank(options.mode)

  const createBackend =
    options.createBackend ??
    ((o: PtyInteractiveBackendOptions): OwnedPtyBackend =>
      new PtyInteractiveBackend(o) as unknown as OwnedPtyBackend)

  let currentMode = options.mode

  // The wrap is read at call time, so a NEW command always runs under the current mode; a process
  // already spawned keeps the wrap it started with, hence the kill on tightening.
  const newBackend = (): OwnedPtyBackend =>
    createBackend({
      wrapCommand: (command, cwd) => wrapFor(currentMode)(command, cwd),
      maxSessions,
    })

  let current = newBackend()

  const replace = (): number => {
    const killed = current.activeSessionCount()
    current.killAll()
    current = newBackend()
    return killed
  }

  return {
    backend: () => current,
    mode: () => currentMode,
    setMode: (mode) => {
      const tightening = rank(mode) < rank(currentMode)
      currentMode = mode
      return { killed: tightening ? replace() : 0 }
    },
    rotate: () => {
      replace()
    },
    shutdown: () => {
      current.killAll()
    },
  }
}
