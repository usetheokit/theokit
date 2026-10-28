import { describe, expect, it } from 'vitest'

import { isAuthenticatedSender, isPolicyOwner, parseAuthorizationPolicy } from '../src/authorization/policy.js'
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

  it('refuses an email or sms broadcast member, whose sender id nothing authenticates', () => {
    for (const member of ['email:a@x.org', 'sms:+15550001111']) {
      const error = refusal({ ...OWNER, THEOCLAW_BROADCAST_GROUPS: `a=${member},telegram:1` })
      expect(error.variable).toBe('THEOCLAW_BROADCAST_GROUPS')
      expect(error.message).toMatch(/^THEOCLAW_BROADCAST_GROUPS cannot list an (email|sms) channel: the .+ is not authenticated, so anyone could write into the group$/)
      expect(error.message).not.toContain(member.slice(member.indexOf(':') + 1))
    }
  })

  it('refuses an sms owner, whose caller id nothing authenticates', () => {
    const error = refusal({ ...OWNER, THEOCLAW_OWNERS: 'slack:U0ABC,sms:+15550001111' })
    expect(error.variable).toBe('THEOCLAW_OWNERS')
    expect(error.message).toBe(
      'THEOCLAW_OWNERS cannot name an sms owner: the caller id of a text message is not authenticated, so anyone could write as the owner',
    )
    expect(error.message).not.toContain('+15550001111')
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

describe('isAuthenticatedSender', () => {
  it('trusts the eight platforms that authenticate their sender and no other', () => {
    const trusted = ['telegram', 'discord', 'slack', 'matrix', 'mattermost', 'line', 'whatsapp', 'teams']
    for (const platform of trusted) expect(isAuthenticatedSender(platform), platform).toBe(true)
    expect(isAuthenticatedSender('email')).toBe(false)
    expect(isAuthenticatedSender('sms')).toBe(false)
  })

  it('refuses a platform it does not know, rather than trusting it', () => {
    expect(isAuthenticatedSender('carrier-pigeon')).toBe(false)
    expect(isAuthenticatedSender('')).toBe(false)
  })
})

describe('isPolicyOwner', () => {
  it('names an owner by platform and sender id', () => {
    const policy = parseAuthorizationPolicy({ ...OWNER, THEOCLAW_OWNERS: 'telegram:42,discord:7' })
    expect(isPolicyOwner(policy, 'telegram', '42')).toBe(true)
    expect(isPolicyOwner(policy, 'discord', '7')).toBe(true)
    expect(isPolicyOwner(policy, 'discord', '42')).toBe(false)
  })

  it('never names an unauthenticated sender an owner, even one a policy lists', () => {
    const parsed = parseAuthorizationPolicy(OWNER)
    const policy = { ...parsed, owners: new Set(['email:owner@example.com', 'sms:+15550001111']) }
    expect(isPolicyOwner(policy, 'email', 'OWNER@example.com')).toBe(false)
    expect(isPolicyOwner(policy, 'sms', '+15550001111')).toBe(false)
  })
})
