import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { hookFingerprint } from './hook-approval.js'

/** The timeout the SDK applies to a hook whose file sets none. */
const DEFAULT_TIMEOUT_MS = 30_000

export interface ListedHook {
  /** The event key as the settings file spells it. */
  readonly event: string
  readonly fingerprint: string
  readonly approved: boolean
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * The command hooks of `<cwd>/.theokit/settings.json`, each with the fingerprint
 * `THEOCLAW_APPROVED_HOOKS` accepts and whether `approved` lists it. A missing file lists none.
 */
export function listProjectHooks(
  cwd: string,
  approved: ReadonlySet<string>,
): readonly ListedHook[] {
  const path = join(cwd, '.theokit', 'settings.json')
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new TheoClawConfigError(`cannot read ${path}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new TheoClawConfigError(`${path} is not valid JSON`)
  }
  const hooks = record(record(parsed)?.hooks) ?? {}
  const listed: ListedHook[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      const commands = record(group)?.hooks
      if (!Array.isArray(commands)) continue
      for (const entry of commands) {
        const hook = record(entry)
        if (hook === undefined || typeof hook.command !== 'string' || hook.command === '') continue
        const timeoutMs =
          typeof hook.timeout === 'number' && hook.timeout > 0
            ? Math.round(hook.timeout * 1000)
            : DEFAULT_TIMEOUT_MS
        const fingerprint = hookFingerprint({
          sourceEvent: event,
          command: hook.command,
          timeoutMs,
        })
        listed.push({ event, fingerprint, approved: approved.has(fingerprint) })
      }
    }
  }
  return listed
}

/** One output line: the event, the fingerprint and the state. The command is never printed. */
export function formatHookLine(hook: ListedHook): string {
  return `${hook.event}  ${hook.fingerprint}  ${hook.approved ? 'approved' : 'not approved'}`
}
