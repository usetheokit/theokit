import type { SandboxMode } from '@theokit/agents/sandbox'

import { TheoClawConfigError } from '../control-plane/errors.js'

/** The modes `THEOCLAW_SANDBOX` accepts, in the order the refusal names them. */
const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const satisfies readonly SandboxMode[]

const DEFAULT_MODE: SandboxMode = 'workspace-write'

function isSandboxMode(value: string): value is SandboxMode {
  return (SANDBOX_MODES as readonly string[]).includes(value)
}

/**
 * The shell's sandbox mode the operator chose with `THEOCLAW_SANDBOX`: unset or blank is
 * `workspace-write`, one of the three modes is itself, anything else is refused. The value is a mode
 * name, not a secret, so the refusal quotes it.
 */
export function readSandboxMode(env: Readonly<Record<string, string | undefined>>): SandboxMode {
  const value = env.THEOCLAW_SANDBOX?.trim() ?? ''
  if (value === '') return DEFAULT_MODE
  if (isSandboxMode(value)) return value
  throw new TheoClawConfigError(`THEOCLAW_SANDBOX must be one of ${SANDBOX_MODES.join(', ')}; got "${value}"`, {
    variable: 'THEOCLAW_SANDBOX',
  })
}

/** The session key of the owner's main session (`THEOCLAW_DM_SCOPE=main`). */
export const MAIN_SESSION_KEY = 'main'

/** Which sessions `THEOCLAW_SANDBOX` binds: every one (default), or all but the main session. */
export type SandboxSessions = 'all' | 'non-main'

/** `THEOCLAW_SANDBOX_SESSIONS`: unset or blank is `all`, `non-main` is itself, anything else is refused. */
export function readSandboxSessions(env: Readonly<Record<string, string | undefined>>): SandboxSessions {
  const value = env.THEOCLAW_SANDBOX_SESSIONS?.trim() ?? ''
  if (value === '' || value === 'all') return 'all'
  if (value === 'non-main') return 'non-main'
  throw new TheoClawConfigError(`THEOCLAW_SANDBOX_SESSIONS must be one of all, non-main; got "${value}"`, {
    variable: 'THEOCLAW_SANDBOX_SESSIONS',
  })
}

/**
 * The sandbox mode of one session. Under `all` every session runs the chosen mode. Under `non-main`
 * the main session runs it and any other session runs `workspace-write`, or `read-only` when that
 * is what was chosen: a session is never given more than the operator's mode allows.
 */
export function sandboxModeForSession(chosen: SandboxMode, sessions: SandboxSessions, sessionKey: string): SandboxMode {
  if (sessions === 'all' || sessionKey === MAIN_SESSION_KEY) return chosen
  return chosen === 'read-only' ? 'read-only' : 'workspace-write'
}
