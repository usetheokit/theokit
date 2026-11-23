import type { PtyOwner } from '@theokit/agents-pty'
import type { SandboxMode } from '@theokit/agents/sandbox'

export const MAX_PTY_SESSIONS = 16

/** The framework's per-session PTY owner, keyed by the sandbox modes. */
export type SessionPtyOwner = PtyOwner<SandboxMode>
