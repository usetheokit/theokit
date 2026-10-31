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
