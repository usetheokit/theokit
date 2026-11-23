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
  /**
   * The environment a session's command gets. `'inherit'` (default) leaves it to the backend; `{ keep, home }`
   * runs the command through `/usr/bin/env -i` with only the named variables (from the process) and `HOME`.
   */
  readonly env?: 'inherit' | { readonly keep: readonly string[]; readonly home: string }
  /** Pins every session's working directory; a `cwd` passed to `startInteractive` is ignored. */
  readonly cwd?: string
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

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function scrubbed(command: string, keep: readonly string[], home: string): string {
  const pairs = new Map<string, string>()
  for (const name of keep) {
    const value = process.env[name]
    if (value !== undefined && name !== 'HOME') pairs.set(name, value)
  }
  pairs.set('HOME', home)
  const assigned = [...pairs].map(([name, value]) => `${name}=${quote(value)}`).join(' ')
  return `/usr/bin/env -i ${assigned} /bin/sh -c ${quote(command)}`
}

/** The backend with every `startInteractive` pinned to `cwd`; all else passes through. */
function pinCwd(backend: OwnedPtyBackend, cwd: string): OwnedPtyBackend {
  return new Proxy(backend, {
    get(target, prop) {
      if (prop === 'startInteractive') {
        return (command: string, opts?: object) =>
          target.startInteractive(command, { ...opts, cwd })
      }
      const value: unknown = Reflect.get(target, prop, target)
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
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
    ((o: PtyInteractiveBackendOptions): OwnedPtyBackend => new PtyInteractiveBackend(o))

  let currentMode = options.mode

  // The wrap is read at call time, so a NEW command always runs under the current mode; a process
  // already spawned keeps the wrap it started with, hence the kill on tightening.
  const envOption = options.env
  const pinned = options.cwd
  const newBackend = (): OwnedPtyBackend => {
    const backend = createBackend({
      wrapCommand: (command, cwd) =>
        wrapFor(currentMode)(
          envOption === undefined || envOption === 'inherit'
            ? command
            : scrubbed(command, envOption.keep, envOption.home),
          cwd,
        ),
      maxSessions,
    })
    return pinned === undefined ? backend : pinCwd(backend, pinned)
  }

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
