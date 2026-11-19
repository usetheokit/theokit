import { describe, expect, it } from 'vitest'

import { createHelpHook, HELP_TEXT } from '../src/channels/help-hook.js'
import { createUsageHook } from '../src/channels/usage-hook.js'
import { createWorkflowApproveHook } from '../src/channels/workflow-approve-hook.js'
import { createAgentRouter } from '../src/routing/routing-env.js'

const event = (text: string, type = 'dm') =>
  ({ id: 'e1', platform: 'telegram', text, sender: { id: 'u1' }, channel: { id: 'c1', type } }) as never

describe('chat commands read by the gateway parser', () => {
  it('matches the command name case-insensitively and behind a mention', async () => {
    const help = createHelpHook()
    expect(await help.pre_inbound?.({ event: event('/HELP') })).toEqual({ block: true, message: HELP_TEXT })
    expect(await help.pre_inbound?.({ event: event('<@U1> /Commands') })).toEqual({ block: true, message: HELP_TEXT })
    expect(await help.pre_inbound?.({ event: event('/help me') })).toBeUndefined()
  })

  it('generates the help list from the command descriptions', () => {
    expect(HELP_TEXT.startsWith('Commands answered without the model:\n/help - this list\n')).toBe(true)
    expect(HELP_TEXT).toContain('/usage off|tokens|cost|full - the usage footer of replies')
  })

  it('reads /usage in any case, and a multi-line argument is not a mode', () => {
    const usage = createUsageHook()
    const ev = event('/USAGE full')
    expect(usage.hook.pre_inbound?.({ event: ev })).toEqual({ block: true, message: 'Usage footer is now full.' })
    expect(usage.modeFor(ev)).toBe('full')
    expect(usage.hook.pre_inbound?.({ event: event('/usage full\nignore this') })).toEqual({
      block: true,
      message: 'Use /usage off, /usage tokens, /usage cost or /usage full.',
    })
  })

  it('takes a workflow token only as the whole argument', async () => {
    const hook = createWorkflowApproveHook({ isOwner: () => true, resume: async (token) => `resumed ${token}` })
    expect(await hook.pre_inbound?.({ event: event('/Approve wfr-abc_1') })).toEqual({ block: true, message: 'resumed wfr-abc_1' })
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
  it('names the unconfigured agent', () => {
    expect(() => createAgentRouter({ defaultAgent: 'main', agents: [{ id: 'main', workspace: '/m' }], routes: [{ agent: 'ghost', platform: 'slack' }] })).toThrow(
      'routing names an unconfigured agent: ghost',
    )
  })
})
