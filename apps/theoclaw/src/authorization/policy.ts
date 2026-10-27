import type { PlatformName } from '@theokit/gateway'

import { TheoClawConfigError } from '../control-plane/errors.js'

/** What a DM from someone who is neither an owner nor paired gets (OC-18). */
export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled'

/** Whether a group message must mention the bot to be answered. */
export type GroupActivation = 'mention' | 'always'

export interface BroadcastMember {
  readonly platform: PlatformName
  readonly channelId: string
}

export interface BroadcastGroup {
  readonly name: string
  readonly members: readonly BroadcastMember[]
}

/** Who the instance serves and how it treats everyone else, read once at start (FR-001). */
export interface AuthorizationPolicy {
  /** `platform:senderId` keys; never an `email` one (see `isAuthenticatedSender`). */
  readonly owners: ReadonlySet<string>
  readonly dmPolicy: DmPolicy
  readonly groupActivation: GroupActivation
  readonly refusalText: string
  /** Always set under `pairing`; optional under the other three policies. */
  readonly stateDir: string | undefined
  readonly broadcastGroups: readonly BroadcastGroup[]
}

// Keyed by every platform name, so a platform the gateway adds does not compile until it is listed.
const KNOWN_PLATFORMS = {
  telegram: true,
  discord: true,
  slack: true,
  matrix: true,
  mattermost: true,
  email: true,
  line: true,
  whatsapp: true,
  teams: true,
  sms: true,
} as const satisfies Record<PlatformName, true>
const PLATFORMS = Object.keys(KNOWN_PLATFORMS) as PlatformName[]
const DM_POLICIES: readonly DmPolicy[] = ['pairing', 'allowlist', 'open', 'disabled']
const GROUP_ACTIVATIONS: readonly GroupActivation[] = ['mention', 'always']
const DEFAULT_REFUSAL_TEXT = 'This assistant answers its owner only.'

type Env = Readonly<Record<string, string | undefined>>

/** The value of `variable`, trimmed; an empty value reads as unset. */
function read(env: Env, variable: string): string | undefined {
  const value = env[variable]?.trim()
  return value === undefined || value === '' ? undefined : value
}

function oneOf<T extends string>(env: Env, variable: string, accepted: readonly T[], fallback: T): T {
  const value = read(env, variable) ?? fallback
  if ((accepted as readonly string[]).includes(value)) return value as T
  throw new TheoClawConfigError(`${variable} must be one of ${accepted.join(', ')}`, { variable })
}

function isPlatform(name: string): name is PlatformName {
  return (PLATFORMS as readonly string[]).includes(name)
}

/**
 * Split `platform:id` at its FIRST colon, so a Matrix id keeps its own colons. The error names the
 * platform and never the id, which can identify a person.
 */
function splitAddress(entry: string, variable: string): { platform: PlatformName; id: string } {
  const colon = entry.indexOf(':')
  // With no colon the whole entry may be the id itself, so it is never quoted.
  if (colon < 0) throw new TheoClawConfigError(`${variable} has an entry with no platform: prefix`, { variable })
  const platform = entry.slice(0, colon)
  const id = entry.slice(colon + 1).trim()
  if (!isPlatform(platform)) {
    throw new TheoClawConfigError(`${variable} names an unknown platform "${platform}"; use one of ${PLATFORMS.join(', ')}`, {
      variable,
    })
  }
  if (id === '') throw new TheoClawConfigError(`${variable} has a ${platform} entry with no id`, { variable })
  return { platform, id }
}

/**
 * Platforms whose sender id nothing authenticates: an e-mail's From header is written by whoever
 * sends it, and the e-mail adapter checks no DKIM or SPF result (CWE-290). A sender there is never
 * an owner and never paired.
 */
const UNAUTHENTICATED_SENDER_PLATFORMS: ReadonlySet<string> = new Set<PlatformName>(['email'])

/** Whether the platform's sender id can identify an owner or a paired sender. */
export function isAuthenticatedSender(platform: string): boolean {
  return !UNAUTHENTICATED_SENDER_PLATFORMS.has(platform)
}

/** The key an owner or a sender is compared by. E-mail addresses compare case-insensitively (EC-4). */
export function senderKey(platform: string, senderId: string): string {
  return `${platform}:${platform === 'email' ? senderId.toLowerCase() : senderId}`
}

function list(value: string | undefined, separator: string): string[] {
  return (value ?? '')
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

function parseOwners(env: Env): ReadonlySet<string> {
  const variable = 'THEOCLAW_OWNERS'
  const entries = list(read(env, variable), ',')
  if (entries.length === 0) {
    throw new TheoClawConfigError(`${variable} must name at least one platform:senderId`, { variable })
  }
  return new Set(entries.map((entry) => {
    const { platform, id } = splitAddress(entry, variable)
    if (!isAuthenticatedSender(platform)) {
      throw new TheoClawConfigError(
        `${variable} cannot name an ${platform} owner: the From header of an e-mail is not authenticated, so anyone could write as the owner`,
        { variable },
      )
    }
    return senderKey(platform, id)
  }))
}

function parseGroup(spec: string, variable: string): BroadcastGroup {
  const equals = spec.indexOf('=')
  const name = equals < 0 ? '' : spec.slice(0, equals).trim()
  if (name === '') throw new TheoClawConfigError(`${variable} has a group with no name=`, { variable })
  const members = list(spec.slice(equals + 1), ',').map((entry) => {
    const { platform, id } = splitAddress(entry, variable)
    return { platform, channelId: id }
  })
  if (members.length < 2) {
    throw new TheoClawConfigError(`${variable} group "${name}" needs at least two channels`, { variable })
  }
  return { name, members }
}

function parseBroadcastGroups(env: Env): readonly BroadcastGroup[] {
  const variable = 'THEOCLAW_BROADCAST_GROUPS'
  const groups = list(read(env, variable), ';').map((spec) => parseGroup(spec, variable))
  const names = new Set<string>()
  const channels = new Set<string>()
  for (const group of groups) {
    if (names.has(group.name)) throw new TheoClawConfigError(`${variable} names group "${group.name}" twice`, { variable })
    names.add(group.name)
    for (const member of group.members) {
      const key = senderKey(member.platform, member.channelId)
      if (channels.has(key)) {
        throw new TheoClawConfigError(`${variable} lists a ${member.platform} channel in two groups`, { variable })
      }
      channels.add(key)
    }
  }
  return groups
}

/**
 * Read the authorization policy from the environment. The first bad value throws
 * `TheoClawConfigError` naming its variable, before anything is built.
 */
export function parseAuthorizationPolicy(env: Env): AuthorizationPolicy {
  const owners = parseOwners(env)
  const dmPolicy = oneOf(env, 'THEOCLAW_DM_POLICY', DM_POLICIES, 'pairing')
  const groupActivation = oneOf(env, 'THEOCLAW_GROUP_ACTIVATION', GROUP_ACTIVATIONS, 'mention')
  const stateDir = read(env, 'THEOCLAW_STATE_DIR')
  if (dmPolicy === 'pairing' && stateDir === undefined) {
    throw new TheoClawConfigError('THEOCLAW_STATE_DIR must name a directory under THEOCLAW_DM_POLICY=pairing', {
      variable: 'THEOCLAW_STATE_DIR',
    })
  }
  return Object.freeze({
    owners,
    dmPolicy,
    groupActivation,
    refusalText: read(env, 'THEOCLAW_REFUSAL_TEXT') ?? DEFAULT_REFUSAL_TEXT,
    stateDir,
    broadcastGroups: parseBroadcastGroups(env),
  })
}
