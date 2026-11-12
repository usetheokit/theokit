import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { hookFingerprint, parseApprovedHooks } from './hook-approval.js'

/** The timeout the SDK applies to a hook command whose file sets none. */
const DEFAULT_TIMEOUT_MS = 30_000

type Env = Readonly<Record<string, string | undefined>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readSettings(cwd: string): Record<string, unknown> | undefined {
  let raw: string
  try {
    raw = readFileSync(join(cwd, '.theokit', 'settings.json'), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    throw new TheoClawConfigError('.theokit/settings.json is not valid JSON', {})
  }
}

/** The SDK reads a hook's `timeout` in seconds and applies it in ms; zero, negative or absent means the default. */
function hookTimeoutMs(timeout: unknown): number {
  return typeof timeout === 'number' && timeout > 0
    ? Math.round(timeout * 1000)
    : DEFAULT_TIMEOUT_MS
}

function commandsOf(groups: unknown): { command: string; timeoutMs: number }[] {
  if (!Array.isArray(groups)) return []
  const found: { command: string; timeoutMs: number }[] = []
  for (const group of groups) {
    const hooks: unknown = isRecord(group) ? group.hooks : undefined
    if (!Array.isArray(hooks)) continue
    for (const hook of hooks) {
      if (!isRecord(hook) || hook.type !== 'command' || typeof hook.command !== 'string') continue
      const timeoutMs = hookTimeoutMs(hook.timeout)
      found.push({ command: hook.command, timeoutMs })
    }
  }
  return found
}

/**
 * One line per command hook in `<cwd>/.theokit/settings.json`: its event, its fingerprint and
 * whether `THEOCLAW_APPROVED_HOOKS` lists that fingerprint. Command text is never printed.
 */
export function listProjectHooks(cwd: string, env: Env): string[] {
  const approved = parseApprovedHooks(env)
  const settings = readSettings(cwd)
  const hooks = settings?.hooks
  if (!isRecord(hooks)) return []
  const lines: string[] = []
  for (const [sourceEvent, groups] of Object.entries(hooks)) {
    for (const { command, timeoutMs } of commandsOf(groups)) {
      const fingerprint = hookFingerprint({ sourceEvent, command, timeoutMs })
      lines.push(
        `${sourceEvent}  ${fingerprint}  ${approved.has(fingerprint) ? 'approved' : 'not approved'}`,
      )
    }
  }
  return lines
}
