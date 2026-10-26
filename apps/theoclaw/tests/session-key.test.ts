import type { MessageEvent, PlatformName } from '@theokit/gateway'
import { describe, expect, it, vi } from 'vitest'

import { createSessionRouter, sessionKeyFor } from '../src/sessions/session-key.js'
import type { SessionKeySettings } from '../src/sessions/session-key.js'

interface EventShape {
  readonly platform?: PlatformName
  readonly sender?: string
  readonly channel?: string
  readonly type?: 'dm' | 'group' | 'thread'
  readonly topicId?: string
}

function event(shape: EventShape = {}): MessageEvent {
  const platform = shape.platform ?? 'telegram'
  return {
    id: 'm-1',
    platform,
    sender: { id: shape.sender ?? 'u1' },
    channel: {
      id: shape.channel ?? 'c1',
      type: shape.type ?? 'dm',
      ...(shape.topicId === undefined ? {} : { topicId: shape.topicId }),
    },
    text: 'hi',
    receivedAt: 0,
    [platform]: { raw: null },
  } as unknown as MessageEvent
}

const DEFAULT: SessionKeySettings = { dmScope: 'per-channel-peer', peerLinks: new Map() }

describe('sessionKeyFor', () => {
  it('keys a group by channel for every sender', () => {
    const first = sessionKeyFor(event({ type: 'group', channel: 'g1', sender: 'alice' }), DEFAULT)
    const second = sessionKeyFor(event({ type: 'group', channel: 'g1', sender: 'bob' }), DEFAULT)
    expect(first).toBe('telegram-grp-g1')
    expect(second).toBe('telegram-grp-g1')
  })

  it('keys a thread with a topic by topic', () => {
    expect(sessionKeyFor(event({ type: 'thread', channel: 'g1', topicId: 't9' }), DEFAULT)).toBe('telegram-tpc-g1-t9')
  })

  it('keys a thread without a topic as its group', () => {
    expect(sessionKeyFor(event({ type: 'thread', channel: 'g1', sender: 'alice' }), DEFAULT)).toBe('telegram-grp-g1')
  })

  it('keys a dm per channel and sender by default', () => {
    expect(sessionKeyFor(event({ type: 'dm', sender: 'u7' }), DEFAULT)).toBe('telegram-dm-u7')
  })

  it('keys every dm as main under main', () => {
    const settings: SessionKeySettings = { ...DEFAULT, dmScope: 'main' }
    expect(sessionKeyFor(event({ sender: 'u1' }), settings)).toBe('main')
    expect(sessionKeyFor(event({ platform: 'discord', sender: 'u2' }), settings)).toBe('main')
  })

  it('keys a linked sender on two platforms to one peer session', () => {
    const settings: SessionKeySettings = {
      dmScope: 'per-peer',
      peerLinks: new Map([
        ['telegram:111', 'paulo'],
        ['discord:222', 'paulo'],
      ]),
    }
    expect(sessionKeyFor(event({ platform: 'telegram', sender: '111' }), settings)).toBe('peer-paulo')
    expect(sessionKeyFor(event({ platform: 'discord', sender: '222' }), settings)).toBe('peer-paulo')
  })

  it('keys an unlinked sender under per-peer per channel and sender', () => {
    const settings: SessionKeySettings = { dmScope: 'per-peer', peerLinks: new Map([['telegram:111', 'paulo']]) }
    expect(sessionKeyFor(event({ platform: 'discord', sender: '111' }), settings)).toBe('discord-dm-111')
  })

  it('adds the account label under per-account-channel-peer', () => {
    const settings: SessionKeySettings = { dmScope: 'per-account-channel-peer', peerLinks: new Map(), accountLabel: 'work' }
    expect(sessionKeyFor(event({ sender: 'u1' }), settings)).toBe('telegram-work-dm-u1')
  })

  it('replaces dashes in every id segment', () => {
    expect(sessionKeyFor(event({ sender: 'a-b' }), DEFAULT)).toBe('telegram-dm-a_b')
    expect(sessionKeyFor(event({ type: 'thread', channel: 'g-1', topicId: 't-2' }), DEFAULT)).toBe('telegram-tpc-g_1-t_2')
  })

  it('gives the same key on 1000 calls and reads no process env', () => {
    const get = vi.fn((target: NodeJS.ProcessEnv, key: string | symbol) => Reflect.get(target, key))
    const spied = new Proxy(process.env, { get })
    const original = process.env
    process.env = spied
    try {
      const keys = new Set<string>()
      const input = event({ type: 'group', channel: 'g1' })
      for (let index = 0; index < 1000; index += 1) keys.add(sessionKeyFor(input, DEFAULT))
      expect(keys.size).toBe(1)
      expect(get).not.toHaveBeenCalled()
    } finally {
      process.env = original
    }
  })
})

describe('createSessionRouter', () => {
  it('resolves an agent id through the session key', () => {
    const router = createSessionRouter(DEFAULT)
    expect(router.resolveAgentId(event({ type: 'group', channel: 'g1' }))).toBe('telegram-grp-g1')
  })
})
