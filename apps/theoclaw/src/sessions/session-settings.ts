import { isAbsolute } from 'node:path'

import type { BindEnvironment } from '../control-plane/bind.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { DM_SCOPES } from './session-key.js'
import type { DmScope, SessionKeySettings } from './session-key.js'

/** Everything the chat sessions read from the environment, read once at start. */
export interface SessionSettings extends SessionKeySettings {
  /** Absolute, existing directory; transcripts and `sessions.json` live under `<workspace>/.theoclaw`. */
  readonly workspace: string
  /** Minutes an agent with no turn in flight stays open, 1 to 1440. */
  readonly idleMinutes: number
  /** Agents kept open at most, 1 to 10000. */
  readonly maxOpenSessions: number
}

/** What the workspace check needs of `fs.statSync`; injected so the unit tests read no file. */
export type StatDirectory = (path: string) => { isDirectory(): boolean }

const PEER_NAME = /^\w+$/

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

function isDmScope(value: string): value is DmScope {
  return (DM_SCOPES as readonly string[]).includes(value)
}

function readDmScope(env: BindEnvironment): DmScope {
  const value = nonBlank(env.THEOCLAW_DM_SCOPE) ?? 'per-channel-peer'
  if (isDmScope(value)) return value
  throw new TheoClawConfigError(`THEOCLAW_DM_SCOPE must be one of ${DM_SCOPES.join(', ')}`, {
    variable: 'THEOCLAW_DM_SCOPE',
  })
}

function peerLinkError(detail: string): TheoClawConfigError {
  return new TheoClawConfigError(`THEOCLAW_PEER_LINKS must be <platform>:<senderId>=<name> pairs separated by commas: ${detail}`, {
    variable: 'THEOCLAW_PEER_LINKS',
  })
}

/** One `<platform>:<senderId>=<name>` pair, split on the first `:` and the last `=`. */
function readPeerLink(pair: string): readonly [string, string] {
  const colon = pair.indexOf(':')
  const equals = pair.lastIndexOf('=')
  if (colon <= 0 || equals <= colon + 1) throw peerLinkError('a pair lacks its platform, sender or equals sign')
  const name = pair.slice(equals + 1).trim()
  if (!PEER_NAME.test(name)) throw peerLinkError('a peer name holds only letters, digits and underscores')
  return [pair.slice(0, equals).trim(), name]
}

function readPeerLinks(env: BindEnvironment): ReadonlyMap<string, string> {
  const links = new Map<string, string>()
  const value = nonBlank(env.THEOCLAW_PEER_LINKS)
  if (value === undefined) return links
  for (const pair of value.split(',')) {
    const [sender, name] = readPeerLink(pair.trim())
    if (links.has(sender)) throw peerLinkError('a sender is linked twice')
    links.set(sender, name)
  }
  return links
}

/**
 * `THEOCLAW_WORKSPACE`, checked. Under `THEOCLAW_PROFILE` the process entry has already set it to the
 * profile's own `workspace` and refused an explicit one (`instance.ts`), so a profiled instance's
 * chat sessions stay in its profile and two profiles never read one `sessions.json`.
 */
function readWorkspace(env: BindEnvironment, stat: StatDirectory): string {
  const workspace = nonBlank(env.THEOCLAW_WORKSPACE)
  const refuse = (why: string): TheoClawConfigError =>
    new TheoClawConfigError(`THEOCLAW_WORKSPACE must be ${why}`, { variable: 'THEOCLAW_WORKSPACE' })
  if (workspace === undefined) throw refuse('set to the directory TheoClaw keeps its chat sessions in')
  if (!isAbsolute(workspace)) throw refuse('an absolute path')
  let isDirectory: boolean
  try {
    isDirectory = stat(workspace).isDirectory()
  } catch {
    isDirectory = false
  }
  if (!isDirectory) throw refuse('an existing directory')
  return workspace
}

function readBound(env: BindEnvironment, variable: string, max: number, fallback: number): number {
  const value = env[variable]
  if (value === undefined || value.trim() === '') return fallback
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= max) return parsed
  throw new TheoClawConfigError(`${variable} must be an integer from 1 to ${max}`, { variable })
}

/**
 * Read and check the session settings, in a fixed order: DM scope, account label, peer links,
 * workspace, idle minutes, open bound. The first bad value throws a `TheoClawConfigError` naming
 * its variable, and no message carries the value refused.
 */
export function readSessionSettings(env: BindEnvironment, stat: StatDirectory): SessionSettings {
  const dmScope = readDmScope(env)
  const accountLabel = nonBlank(env.THEOCLAW_ACCOUNT_LABEL)
  if (dmScope === 'per-account-channel-peer' && accountLabel === undefined) {
    throw new TheoClawConfigError('THEOCLAW_ACCOUNT_LABEL must be set under THEOCLAW_DM_SCOPE=per-account-channel-peer', {
      variable: 'THEOCLAW_ACCOUNT_LABEL',
    })
  }
  const peerLinks = readPeerLinks(env)
  const workspace = readWorkspace(env, stat)
  return {
    dmScope,
    peerLinks,
    ...(dmScope === 'per-account-channel-peer' && accountLabel !== undefined ? { accountLabel } : {}),
    workspace,
    idleMinutes: readBound(env, 'THEOCLAW_SESSION_IDLE_MINUTES', 1440, 30),
    maxOpenSessions: readBound(env, 'THEOCLAW_MAX_OPEN_SESSIONS', 10_000, 200),
  }
}
