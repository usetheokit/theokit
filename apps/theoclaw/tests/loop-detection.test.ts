import { describe, expect, it } from 'vitest'

import { loopDetectionPlugin } from '../src/tools/loop-detection.js'

type Handler = (context: unknown) => unknown
const handlerOf = (limit?: number): Handler => {
  let handler: Handler | undefined
  loopDetectionPlugin(limit === undefined ? {} : { limit }).register({ on: (_e: string, fn: Handler) => void (handler = fn) } as never)
  if (handler === undefined) throw new Error('no handler')
  return handler
}

describe('loop detection', () => {
  it('stops a run that repeats the same call and says why', () => {
    const handler = handlerOf(2)
    const call = { name: 'read_file', args: { path: 'a' } }
    expect(handler(call)).toBeUndefined()
    expect(handler(call)).toBeUndefined()
    expect(handler(call)).toMatchObject({ block: true, message: expect.stringMatching(/loop detected: read_file was called 3 times/) })
  })

  it('lets a changed call reset the streak', () => {
    const handler = handlerOf(2)
    const a = { name: 'read_file', args: { path: 'a' } }
    handler(a)
    handler(a)
    expect(handler({ name: 'read_file', args: { path: 'b' } })).toBeUndefined()
    expect(handler(a)).toBeUndefined()
  })
})
