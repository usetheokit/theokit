import 'reflect-metadata'

import { describe, expect, it } from 'vitest'

import type { GatewayContext, MessageEvent } from '@theokit/gateway'

import { createHelpHook, HELP_TEXT } from '../src/channels/help-hook.js'
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
