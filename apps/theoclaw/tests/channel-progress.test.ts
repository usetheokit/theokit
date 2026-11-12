import 'reflect-metadata'

import { describe, expect, it } from 'vitest'

import type { GatewayContext, MessageEvent, PlatformName } from '@theokit/gateway'

import { createReplyHandler } from '../src/channels/reply-handler.js'
import type { DisplayConfig } from '../src/channels/display-config.js'
import type { SessionLease } from '../src/sessions/session-agents.js'
import { FakeAgent, assistant, finished, messageEvent, thinking } from './fakes.js'

const toolCall = (name: string, args: unknown) => ({ type: 'tool_call', call_id: `c-${name}`, name, status: 'running', args })

async function turn(platform: PlatformName, display?: DisplayConfig): Promise<string[]> {
  const agent = new FakeAgent({
    frames: [thinking('hmm'), toolCall('read', { path: '/a' }), toolCall('read', { path: '/b' }), assistant('Done.'), finished()],
  })
  const event: MessageEvent = messageEvent(platform, 'go')
  const sent: string[] = []
  const ctx: GatewayContext = {
    event,
    reply: async (text) => {
      sent.push(text)
      return { ok: true, messageId: 'm' }
    },
  }
  const withAgent = async <R>(_e: MessageEvent, work: (lease: SessionLease) => R | Promise<R>) =>
    work({ agent, release: () => undefined })
  await createReplyHandler({ reset: async () => undefined, withAgent, ...(display ? { display } : {}) })(event, ctx)
  return sent
}

describe('display tiers in the reply path', () => {
  it.each(['telegram', 'slack'] as const)('%s receives only the answer: tool progress is off', async (platform) => {
    expect(await turn(platform)).toEqual(['Done.'])
  })

  it('email and sms receive only the answer', async () => {
    expect(await turn('email')).toEqual(['Done.'])
    expect(await turn('sms')).toEqual(['Done.'])
  })

  it('discord (high) sends a progress line per tool call, with a preview, before the answer', async () => {
    const sent = await turn('discord')
    expect(sent).toHaveLength(3)
    expect(sent[0]).toContain('read')
    expect(sent[0]).toContain('/a')
    expect(sent.at(-1)).toBe('Done.')
  })

  it('matrix (medium) sends one verb-only line for repeated calls of one tool', async () => {
    expect(await turn('matrix')).toEqual(['read', 'Done.'])
  })

  it('an override turns Telegram progress on, and reasoning display on', async () => {
    const sent = await turn('telegram', { platforms: { telegram: { tool_progress: 'new', show_reasoning: true } } })
    expect(sent).toEqual(['hmm', 'read {"path":"/a"}', 'Done.'])
  })

  it('never sends reasoning by default, even where progress is on', async () => {
    expect((await turn('discord')).join('\n')).not.toContain('hmm')
  })
})
