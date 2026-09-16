/**
 * B-076 — changing the sandbox posture at runtime.
 *
 * `/approval` and the sandbox mode are two halves of ONE decision about what the agent may do to
 * the disk, and only one was editable: the other was a label in the footer. A user who realised
 * mid-session that the posture was wrong had to quit and relaunch.
 */
import { SANDBOX_MODES } from '@theocode/agent/config'
import type { SandboxMode } from '@theocode/agent/config'

/** Least to most permissive. The order IS the confirmation rule, so it lives with the values. */
const PERMISSIVENESS: readonly SandboxMode[] = [
  'read-only',
  'workspace-write',
  'danger-full-access',
]

export function parseSandboxMode(input: string): SandboxMode | null {
  const v = input.trim().toLowerCase()
  return (SANDBOX_MODES as readonly string[]).includes(v) ? (v as SandboxMode) : null
}

/**
 * Whether moving from `from` to `to` LOOSENS the posture.
 *
 * Loosening needs an explicit confirmation; tightening does not. The asymmetry is the point: a user
 * hardening mid-session is protecting themselves and should not be argued with, while one loosening
 * is granting the agent more of their disk and should have to mean it.
 */
export function isLoosening(from: SandboxMode, to: SandboxMode): boolean {
  return PERMISSIVENESS.indexOf(to) > PERMISSIVENESS.indexOf(from)
}

/**
 * The pending loosening, if any. A confirmation needs state that survives between two commands, and
 * this is the smallest that does — the same shape the composer's `exitArmed` uses for Ctrl+C.
 *
 * Cleared by ANY other sandbox command, so an abandoned confirmation cannot be completed later by
 * accident: `/sandbox danger-full-access` then `/sandbox read-only` then `/sandbox confirm` must not
 * grant full access.
 */
let armed: SandboxMode | undefined

export function armLoosening(mode: SandboxMode): void {
  armed = mode
}

export function takeArmed(): SandboxMode | undefined {
  const m = armed
  armed = undefined
  return m
}

export function clearArmed(): void {
  armed = undefined
}
