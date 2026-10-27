import { describe, expect, it } from 'vitest'

import { parseAuthorizationPolicy } from '../src/authorization/policy.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'

/** The parse error of `env`, so a test asserts its type, its message and the variable it names. */
function refusal(env: Record<string, string | undefined>): TheoClawConfigError {
  try {
    parseAuthorizationPolicy(env)
  } catch (error) {
    if (error instanceof TheoClawConfigError) return error
    throw error
  }
  throw new Error('expected parseAuthorizationPolicy to refuse the environment')
}

const OWNER = { THEOCLAW_OWNERS: 'telegram:42', THEOCLAW_STATE_DIR: '/state' }

describe('parseAuthorizationPolicy', () => {
  it('requires at least one owner', () => {
    const error = refusal({ THEOCLAW_STATE_DIR: '/state' })
    expect(error.variable).toBe('THEOCLAW_OWNERS')
    expect(error.message).toContain('THEOCLAW_OWNERS must name at least one platform:senderId')
    expect(refusal({ THEOCLAW_OWNERS: ' , ', THEOCLAW_STATE_DIR: '/state' }).variable).toBe('THEOCLAW_OWNERS')
  })

  it('defaults to pairing and mention', () => {
    const policy = parseAuthorizationPolicy(OWNER)
    expect([...policy.owners]).toEqual(['telegram:42'])
    expect(policy.dmPolicy).toBe('pairing')
    expect(policy.groupActivation).toBe('mention')
    expect(policy.refusalText).toBe('This assistant answers its owner only.')
    expect(policy.stateDir).toBe('/state')
    expect(policy.broadcastGroups).toEqual([])
    expect(Object.isFrozen(policy)).toBe(true)
  })

  it('refuses a DM policy outside the four values and names the variable', () => {
    const error = refusal({ ...OWNER, THEOCLAW_DM_POLICY: 'everyone' })
    expect(error.variable).toBe('THEOCLAW_DM_POLICY')
    expect(error.message).toContain('pairing, allowlist, open, disabled')
    expect(refusal({ ...OWNER, THEOCLAW_GROUP_ACTIVATION: 'never' }).variable).toBe('THEOCLAW_GROUP_ACTIVATION')
  })

  it('refuses an owner on a platform outside the ten and names the platform, never the id', () => {
    const error = refusal({ ...OWNER, THEOCLAW_OWNERS: 'irc:secret-user-id' })
    expect(error.variable).toBe('THEOCLAW_OWNERS')
    expect(error.message).toContain('irc')
    expect(error.message).not.toContain('secret-user-id')
    expect(refusal({ ...OWNER, THEOCLAW_OWNERS: 'telegram' }).variable).toBe('THEOCLAW_OWNERS')
  })

  it('refuses an owner written without a platform prefix and never quotes the entry', () => {
    const error = refusal({ ...OWNER, THEOCLAW_OWNERS: 'Paulo@Example.com' })
    expect(error.variable).toBe('THEOCLAW_OWNERS')
    expect(error.message).toContain('platform:')
    expect(error.message.toLowerCase()).not.toContain('paulo')
  })

  it('requires THEOCLAW_STATE_DIR under pairing', () => {
    expect(refusal({ THEOCLAW_OWNERS: 'telegram:42' }).variable).toBe('THEOCLAW_STATE_DIR')
  })

  it('accepts allowlist open and disabled without THEOCLAW_STATE_DIR', () => {
    for (const dmPolicy of ['allowlist', 'open', 'disabled'] as const) {
      const policy = parseAuthorizationPolicy({ THEOCLAW_OWNERS: 'telegram:42', THEOCLAW_DM_POLICY: dmPolicy })
      expect(policy.dmPolicy).toBe(dmPolicy)
      expect(policy.stateDir).toBeUndefined()
    }
    const kept = parseAuthorizationPolicy({ ...OWNER, THEOCLAW_DM_POLICY: 'allowlist' })
    expect(kept.stateDir).toBe('/state')
  })

  it('keeps the colons of a matrix id', () => {
    const policy = parseAuthorizationPolicy({
      ...OWNER,
      THEOCLAW_OWNERS: ' matrix:@paulo:matrix.org , telegram:42 ',
      THEOCLAW_BROADCAST_GROUPS: 'home=matrix:!room:matrix.org,telegram:-100',
    })
    expect([...policy.owners]).toEqual(['matrix:@paulo:matrix.org', 'telegram:42'])
    expect(policy.broadcastGroups[0]?.members[0]).toEqual({ platform: 'matrix', channelId: '!room:matrix.org' })
  })

  it('parses two broadcast groups and refuses a one-member group', () => {
    const policy = parseAuthorizationPolicy({
      ...OWNER,
      THEOCLAW_BROADCAST_GROUPS: 'home=telegram:1,discord:2; work=slack:C1,mattermost:M1',
    })
    expect(policy.broadcastGroups).toEqual([
      {
        name: 'home',
        members: [
          { platform: 'telegram', channelId: '1' },
          { platform: 'discord', channelId: '2' },
        ],
      },
      {
        name: 'work',
        members: [
          { platform: 'slack', channelId: 'C1' },
          { platform: 'mattermost', channelId: 'M1' },
        ],
      },
    ])
    const error = refusal({ ...OWNER, THEOCLAW_BROADCAST_GROUPS: 'home=telegram:1' })
    expect(error.variable).toBe('THEOCLAW_BROADCAST_GROUPS')
    expect(refusal({ ...OWNER, THEOCLAW_BROADCAST_GROUPS: 'a=telegram:1,discord:2;a=slack:3,line:4' }).variable).toBe(
      'THEOCLAW_BROADCAST_GROUPS',
    )
  })

  it('refuses a channel listed in two broadcast groups', () => {
    const error = refusal({ ...OWNER, THEOCLAW_BROADCAST_GROUPS: 'a=telegram:1,discord:2;b=telegram:1,slack:3' })
    expect(error.variable).toBe('THEOCLAW_BROADCAST_GROUPS')
  })

  it('compares email broadcast channels case-insensitively', () => {
    const error = refusal({ ...OWNER, THEOCLAW_BROADCAST_GROUPS: 'a=email:A@x.org,telegram:1;b=email:a@x.org,slack:3' })
    expect(error.variable).toBe('THEOCLAW_BROADCAST_GROUPS')
  })

  it('refuses an email owner, whose From header nothing authenticates', () => {
    const error = refusal({ ...OWNER, THEOCLAW_OWNERS: 'slack:U0ABC,email:paulo@example.com' })
    expect(error.variable).toBe('THEOCLAW_OWNERS')
    expect(error.message).toBe(
      'THEOCLAW_OWNERS cannot name an email owner: the From header of an e-mail is not authenticated, so anyone could write as the owner',
    )
    expect(error.message).not.toContain('paulo@example.com')
  })
})
