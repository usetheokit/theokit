import { parseAuthorizationPolicy } from '../src/authorization/policy.js'
import { describe, expect, it } from 'vitest'

import { channelHooks } from '../src/channel-hooks.js'
import { createInfoHook, infoReply } from '../src/channels/info-commands.js'
import { HELP_TEXT } from '../src/channels/help-hook.js'

describe('infoReply', () => {
  it('answers /model and /status through the agents command router', () => {
    expect(infoReply('/model', 'm-1', 'webchat')).toBe('Model: m-1')
    expect(infoReply('/model@theobot', 'm-1', 'telegram')).toBe('Model: m-1')
    expect(infoReply('/model other', 'm-1', 'webchat')).toContain('not supported')
    expect(infoReply('/status', 'm-1', 'telegram')).toContain('Surface: telegram')
  })
  it('leaves other text, including a longer command name, alone', () => {
    expect(infoReply('/modelx', 'm', 's')).toBeUndefined()
    expect(infoReply('hello /model', 'm', 's')).toBeUndefined()
    expect(infoReply('/help', 'm', 's')).toBeUndefined()
  })
  it('is listed by /help', () => {
    expect(HELP_TEXT).toContain('/status, /model')
  })
})

describe('the channel hook', () => {
  it('blocks /model with the reply, and is in the hook list only with a model', async () => {
    const decision = await createInfoHook('m-1').pre_inbound?.({
      event: { text: '/model', platform: 'telegram' },
    } as never)
    expect(decision).toEqual({ block: true, message: 'Model: m-1' })
    const policy = parseAuthorizationPolicy({
      THEOCLAW_OWNERS: 'telegram:1',
      THEOCLAW_DM_POLICY: 'open',
    })
    const names = channelHooks({ policy, write: () => undefined, model: 'm-1' }).map(
      (hook) => hook.name,
    )
    expect(names).toContain('theoclaw-status')
  })
})
