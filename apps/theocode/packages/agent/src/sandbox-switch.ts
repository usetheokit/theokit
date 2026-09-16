/**
 * B-076 — changing the sandbox mode without restarting.
 *
 * The footer reported `sandbox:workspace-write` and nothing could change it, while `/approval` —
 * the OTHER half of the same decision about what the agent may do to the disk — was editable at
 * runtime. A user who realised mid-session that the posture was wrong had to quit and relaunch.
 *
 * A module-level override, like the memory switch (B-077): the agent is rebuilt every turn, so it
 * takes effect on the NEXT turn and no running turn is reconfigured underneath itself. NOT
 * persisted — a durable posture belongs in config where it can be reviewed, and `/status` reports
 * the live value so the override is never invisible.
 *
 * It can only be set to a mode the SECURITY FLOOR already permits; `chat.ts` still applies that
 * floor to the result, so this cannot be used to escape a restriction the directory imposes.
 */
import type { SandboxMode } from './config/config.js'

let override: SandboxMode | undefined

export function setSandboxModeForSession(mode: SandboxMode | undefined): void {
  override = mode
}

/** The session's mode, or the configured one when nothing has been overridden. */
export function sandboxModeForSession(configured: SandboxMode): SandboxMode {
  return override ?? configured
}
