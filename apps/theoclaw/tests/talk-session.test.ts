import { describe, expect, it } from 'vitest'
import { createTalkSession, stripWakeWord } from '../src/voice/talk-session.js'

function setup(wakeWord?: string) {
  let clock = 0
  const log: string[] = []
  const heard = ['hello there', 'hey theo what is two plus two', 'and times three', 'noise']
  const session = createTalkSession({
    wakeWord,
    awakeMs: 1000,
    now: () => clock,
    transcribe: async (u) => heard[u[0]!]!,
    turn: async (t) => { log.push(`turn:${t}`); return `answer to ${t}` },
    speak: async (t) => { log.push(`say:${t}`) },
  })
  return { session, log, advance: (ms: number) => { clock += ms } }
}

describe('talk session', () => {
  it('exchanges consecutive turns without a per-message send', async () => {
    const { session, log } = setup()
    expect(await session.hear(Uint8Array.of(1))).toBe('replied')
    expect(await session.hear(Uint8Array.of(2))).toBe('replied')
    expect(log).toHaveLength(4)
  })

  it('ignores speech until the wake word, then stays awake, then sleeps', async () => {
    const { session, log, advance } = setup('Hey, Theo')
    expect(await session.hear(Uint8Array.of(0))).toBe('ignored')
    expect(log).toEqual([])
    expect(await session.hear(Uint8Array.of(1))).toBe('replied')
    expect(log[0]).toBe('turn:what is two plus two')
    advance(500)
    expect(await session.hear(Uint8Array.of(2))).toBe('replied')
    advance(5000)
    expect(await session.hear(Uint8Array.of(3))).toBe('ignored')
  })

  it('matches the wake word only at the start', () => {
    expect(stripWakeWord('Hey Theo!', 'hey theo')).toBe('')
    expect(stripWakeWord('say hey theo', 'hey theo')).toBeUndefined()
    expect(stripWakeWord('hey theology', 'hey theo')).toBeUndefined()
  })
})
