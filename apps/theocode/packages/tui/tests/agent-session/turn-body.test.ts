import { describe, expect, it } from 'vitest'

import { buildTurnBody, type TurnSession } from '../../src/agent-session/turn-body.js'
import { createTuiSession } from '../../src/agent-session/tui-session.js'

const img = { mediaType: 'image/png', data: 'x' } as never

function fake(over: Partial<TurnSession> = {}): TurnSession {
  return {
    effort: () => 'medium',
    sessionModel: () => undefined,
    takeImages: () => undefined,
    ...over,
  }
}

describe('buildTurnBody', () => {
  it('carries the session effort and message', () => {
    expect(buildTurnBody(fake({ effort: () => 'high' }), { message: 'hi' })).toEqual({
      message: 'hi',
      effort: 'high',
    })
  })

  it('prefers the turn model over the session model, and falls back to it', () => {
    const s = fake({ sessionModel: () => 'pinned' })
    expect(buildTurnBody(s, { message: 'a', model: 'once' }).model).toBe('once')
    expect(buildTurnBody(s, { message: 'b' }).model).toBe('pinned')
  })

  it('takes pending images for one turn only, and reset drops them', () => {
    const session = createTuiSession({
      cwd: '/tmp',
      loadConfig: (() => ({ reasoning_effort: 'low' })) as never,
    })
    session.attachImages([img])
    expect(buildTurnBody(session, { message: 'a' }).images).toEqual([img])
    expect(buildTurnBody(session, { message: 'b' }).images).toBeUndefined()
    session.attachImages([img])
    session.attachImages(undefined)
    expect(buildTurnBody(session, { message: 'c' }).images).toBeUndefined()
  })
})
