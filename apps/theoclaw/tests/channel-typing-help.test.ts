import 'reflect-metadata'

import { describe, expect, it } from 'vitest'

import type { GatewayContext, MessageEvent } from '@theokit/gateway'

import { createGroupActivationHook } from '../src/channels/group-activation-hook.js'
import { createUsageHook } from '../src/channels/usage-hook.js'
import { createHelpHook, HELP_COMMANDS, HELP_TEXT } from '../src/channels/help-hook.js'
import { createReplyHandler } from '../src/channels/reply-handler.js'
import { showTyping } from '../src/channels/typing.js'
import { FakeAdapter, FakeAgent, assistant, finished, messageEvent } from './fakes.js'

class TypingAdapter extends FakeAdapter {
  readonly calls: string[] = []
  override async startTyping(id: string): Promise<void> {
    this.calls.push(`start:${id}`)
  }
  override async stopTyping(id: string): Promise<void> {
    this.calls.push(`stop:${id}`)
  }
}

function ctxFor(event: MessageEvent, log: string[]): GatewayContext {
  return { event, reply: async (text) => (log.push(`reply:${text}`), { ok: true, messageId: 'm' }) }
}

describe('typing indicator (OC-106)', () => {
  it('shows while the turn runs and stops before the lease is released, then the reply is sent', async () => {
    const adapter = new TypingAdapter('telegram')
    const event = messageEvent('telegram', 'hello')
    const log: string[] = []
    const agent = new FakeAgent({ frames: [assistant('Hi!'), finished()] })
    const handler = createReplyHandler({
      withAgent: async (_e, work) => work({ agent, release: () => void log.push('release') }),
      reset: async () => undefined,
      typing: { adapterFor: () => adapter },
    })
    await handler(event, ctxFor(event, log))
    expect(adapter.calls).toEqual([`start:${event.channel.id}`, `stop:${event.channel.id}`])
    expect(log.at(-1)).toBe('release')
    expect(log.some((line) => line.startsWith('reply:'))).toBe(true)
  })

  it('renews while running, stops once, and survives an adapter that throws', async () => {
    const adapter = new TypingAdapter('telegram')
    adapter.startTyping = async () => {
      throw new Error('boom')
    }
    const stop = showTyping({ adapterFor: () => adapter, renewMs: 5 }, 'telegram', 'c1')
    await new Promise((r) => setTimeout(r, 30))
    await stop()
    await stop()
    expect(adapter.calls).toEqual(['stop:c1'])
  })

  it('does nothing for a platform that is not started', async () => {
    await showTyping({ adapterFor: () => undefined }, 'telegram', 'c1')()
  })
})

describe('/help (OC-105)', () => {
  it('answers with the command list and blocks the message from the model', () => {
    const hook = createHelpHook()
    const decide = (text: string) => hook.pre_inbound?.({ event: messageEvent('telegram', text) } as never)
    expect(decide('/help')).toEqual({ block: true, message: HELP_TEXT })
    expect(decide('/help@mybot')).toEqual({ block: true, message: HELP_TEXT })
    expect(decide('/commands')).toEqual({ block: true, message: HELP_TEXT })
    expect(decide('/helpful')).toBeUndefined()
    expect(decide('please /help')).toBeUndefined()
  })
})

describe('the commands /help lists', () => {
  it('each is answered by its own handler without a model turn', async () => {
    const usage = createUsageHook().hook
    const activation = createGroupActivationHook({ isOwner: () => true, mode: 'mention', write: () => undefined })
    let sends = 0
    const agent = { send: async () => (sends += 1, never()) } as never
    const never = (): never => {
      throw new Error('the model was reached')
    }
    const handler = createReplyHandler({
      withAgent: async (_e, work) => work({ agent, release: () => undefined }),
      reset: async () => undefined,
      goal: { tokenBudget: 1, judge: () => never() },
    })
    for (const command of HELP_COMMANDS) {
      expect(HELP_TEXT).toContain(command)
      // /activation is a group command: in a DM it is an ordinary message.
      const base = messageEvent('telegram', command)
      const event = { ...base, channel: { ...base.channel, type: 'group' } } as MessageEvent
      const hooked = [usage, activation].map((hook) => hook.pre_inbound?.({ event } as never))
      const log: string[] = []
      if ((await Promise.all(hooked)).some((d) => d?.block === true)) continue
      await handler(event, ctxFor(event, log)).catch(() => undefined)
      expect(log.length).toBeGreaterThan(0)
    }
    expect(sends).toBe(0)
  })
})
