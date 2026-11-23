import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { InteractiveBackend } from '@theokit/agents/interactive'
import { createConfinedPtyBackend, probeConfinement } from '@theokit/sdk-pty'

import type { ToolSettings } from './tool-settings.js'

export interface InteractiveDeps {
  readonly warn?: (message: string) => void
  /** The environment the shell's kept variables come from. Default: the process's. */
  readonly processEnv?: Readonly<Record<string, string | undefined>>
}

/** A confined backend for these settings: fixed root, scrubbed environment, the session's sandbox. Not yet probed. */
export function createConfinedInteractive(settings: ToolSettings, deps: InteractiveDeps = {}): InteractiveBackend {
  return createConfinedPtyBackend({
    root: settings.toolRoot,
    mode: settings.mode,
    sourceEnv: deps.processEnv ?? process.env,
  })
}

/**
 * `settings` with the interactive shell, only when the probe passes on this host: host tools on, an
 * enforced sandbox, and a real session that writes in the tool root and nowhere else. Otherwise
 * `settings` itself with a line saying why the shell is off.
 */
export async function withInteractiveShell(settings: ToolSettings, deps: InteractiveDeps = {}): Promise<ToolSettings> {
  if (!settings.hostTools) return settings
  const off = (why: string): ToolSettings => ({ ...settings, offLines: [...settings.offLines, `tools: interactive_shell is off (${why})`] })
  if (!settings.sandboxEnforced) return off('sandbox not enforced')
  if (settings.backend === 'docker') return off('THEOCLAW_SANDBOX_BACKEND=docker has no interactive shell')
  const interactive = createConfinedInteractive(settings, deps)
  mkdirSync(settings.toolRoot, { recursive: true })
  const id = randomBytes(6).toString('hex')
  const proof = await probeConfinement(interactive, {
    inside: join(settings.toolRoot, `.probe-in-${id}`),
    outside: join(settings.workspace, `.probe-out-${id}`),
  })
  if (!proof.confined) {
    deps.warn?.(`tools: interactive_shell probe failed: ${proof.reason}${proof.detail === undefined ? '' : ` (${proof.detail})`}`)
    return off('no confined session could be proven on this host: needs node-pty and THEOCLAW_SANDBOX=workspace-write')
  }
  return { ...settings, interactive }
}
