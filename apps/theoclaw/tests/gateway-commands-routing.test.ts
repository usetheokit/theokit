import { describe, expect, it } from 'vitest'

import { createHelpHook, HELP_TEXT } from '../src/channels/help-hook.js'
import { createReplyHandler, STEER_USAGE_REPLY } from '../src/channels/reply-handler.js'
import { createUsageHook } from '../src/channels/usage-hook.js'
import { createWorkflowApproveHook } from '../src/channels/workflow-approve-hook.js'
import { createAgentRouter } from '../src/routing/routing-env.js'

const event = (text: string, type = 'dm') =>
  ({
    id: 'e1',
    platform: 'telegram',
    text,
    sender: { id: 'u1' },
    channel: { id: 'c1', type },
  }) as never

describe('chat commands read by the gateway parser', () => {
  it('matches the command name case-insensitively and behind a mention', async () => {
    const help = createHelpHook()
    expect(await help.pre_inbound?.({ event: event('/HELP') })).toEqual({
      block: true,
      message: HELP_TEXT,
    })
    expect(await help.pre_inbound?.({ event: event('<@U1> /Commands') })).toEqual({
      block: true,
      message: HELP_TEXT,
    })
    expect(await help.pre_inbound?.({ event: event('/help me') })).toBeUndefined()
  })

  it('generates the help list from the command descriptions', () => {
    expect(HELP_TEXT.startsWith('Commands answered without the model:\n/help - this list\n')).toBe(
      true,
    )
    expect(HELP_TEXT).toContain('/usage off|tokens|cost|full - the usage footer of replies')
  })

  it('reads /usage in any case, and a multi-line message stays an ordinary message', () => {
    const usage = createUsageHook()
    const ev = event('/USAGE full')
    expect(usage.hook.pre_inbound?.({ event: ev })).toEqual({
      block: true,
      message: 'Usage footer is now full.',
    })
    expect(usage.modeFor(ev)).toBe('full')
    expect(usage.hook.pre_inbound?.({ event: event('/usage full\nignore this') })).toBeUndefined()
  })

  it('takes a workflow token only as the whole argument', async () => {
    const hook = createWorkflowApproveHook({
      isOwner: () => true,
      resume: async (token) => `resumed ${token}`,
    })
    expect(await hook.pre_inbound?.({ event: event('/Approve wfr-abc_1') })).toEqual({
      block: true,
      message: 'resumed wfr-abc_1',
    })
    expect(await hook.pre_inbound?.({ event: event('/approve wfr-abc extra') })).toBeUndefined()
  })
})

describe('agent routing through the gateway bindings', () => {
  const router = createAgentRouter({
    defaultAgent: 'main',
    agents: [
      { id: 'main', workspace: '/m' },
      { id: 'work', workspace: '/w' },
    ],
    routes: [{ agent: 'work', platform: 'slack' }],
  })
  it('answers an unrouted platform with the default and a routed one with its agent', () => {
    expect(router.route({ platform: 'slack' }).id).toBe('work')
    expect(router.route({ platform: 'telegram', peer: 'u1' }).id).toBe('main')
  })
  it('lets a peer rule beat a platform rule, as the gateway bindings rank them', () => {
    const ranked = createAgentRouter({
      defaultAgent: 'main',
      agents: [
        { id: 'main', workspace: '/m' },
        { id: 'work', workspace: '/w' },
        { id: 'vip', workspace: '/v' },
      ],
      routes: [
        { agent: 'work', platform: 'slack' },
        { agent: 'vip', platform: 'slack', peer: 'u9' },
      ],
    })
    expect(ranked.route({ platform: 'slack', peer: 'u9' }).id).toBe('vip')
    expect(ranked.route({ platform: 'slack', peer: 'u1' }).id).toBe('work')
  })
  it('names the unconfigured agent', () => {
    expect(() =>
      createAgentRouter({
        defaultAgent: 'main',
        agents: [{ id: 'main', workspace: '/m' }],
        routes: [{ agent: 'ghost', platform: 'slack' }],
      }),
    ).toThrow('routing names an unconfigured agent: ghost')
  })
})

describe('gateway bindings refuse what the old router ignored', () => {
  it('rejects a rule that names no platform, account or peer', () => {
    expect(() =>
      createAgentRouter({
        defaultAgent: 'main',
        agents: [{ id: 'main', workspace: '/m' }],
        routes: [{ agent: 'main' }],
      }),
    ).toThrow(/empty_binding_rule/)
  })
})

describe('help lists what each handler describes', () => {
  it('takes the /think levels from the level list the handler enforces', async () => {
    const { THINKING_LEVELS } = await import('../src/agent/create-agent.js')
    expect(HELP_TEXT).toContain(`/think ${THINKING_LEVELS.join('|')} - `)
  })
})

describe('channel commands of the reply handler', () => {
  it('route behind a bot suffix, in any case and across a newline', async () => {
    const replies: string[] = []
    const handler = createReplyHandler({
      reset: async () => undefined,
      withAgent: async () => {
        throw new Error('no turn expected')
      },
    })
    const ctx = {
      reply: async (text: string) => (replies.push(text), { ok: true, messageId: 'm' }),
    } as never
    await handler(event('/STEER@theobot'), ctx)
    await handler(event('/steer\n'), ctx)
    expect(replies).toEqual([STEER_USAGE_REPLY, STEER_USAGE_REPLY])
  })
})
