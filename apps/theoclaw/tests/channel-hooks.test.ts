import { describe, expect, it } from 'vitest'

import { parseAuthorizationPolicy } from '../src/authorization/policy.js'
import { channelHooks } from '../src/channel-hooks.js'
import { createUsageHook } from '../src/channels/usage-hook.js'

describe('channelHooks', () => {
  it('runs the owner policy before group activation', () => {
    const policy = parseAuthorizationPolicy({ THEOCLAW_OWNERS: 'telegram:1', THEOCLAW_DM_POLICY: 'open' })
    const names = channelHooks({ policy, write: () => undefined }).map((hook) => hook.name)
    expect(names).toEqual(['theoclaw-owner-policy', 'theoclaw-group-activation'])
  })

  it('answers /usage third, after the owner policy (B-400)', () => {
    const policy = parseAuthorizationPolicy({ THEOCLAW_OWNERS: 'telegram:1', THEOCLAW_DM_POLICY: 'open' })
    const names = channelHooks({ policy, write: () => undefined, usage: createUsageHook().hook }).map((hook) => hook.name)
    expect(names).toEqual(['theoclaw-owner-policy', 'theoclaw-group-activation', 'theoclaw-usage'])
  })
})
