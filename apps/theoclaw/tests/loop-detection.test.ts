import { describe, expect, it } from 'vitest'

import { loopDetectionPlugin } from '../src/tools/loop-detection.js'

type Handler = (context: unknown) => unknown

function handlerOf(options?: Parameters<typeof loopDetectionPlugin>[0]): Handler {
  let handler: Handler | undefined
  loopDetectionPlugin(options).register({ on: (_event: string, fn: Handler) => void (handler = fn) } as never)
  if (handler === undefined) throw new Error('no handler')
  return handler
}

describe('loop detection', () => {
  it('stops a run that repeats the same tool call, with a stated reason', () => {
    const handler = handlerOf()
    const call = { name: 'read_file', args: { path: 'a.txt' } }
    for (let i = 0; i < 3; i++) expect(handler(call)).toBeUndefined()
    expect(handler(call)).toMatchObject({ block: true, message: expect.stringMatching(/loop detected: read_file/) })
  })

  it('lets different arguments and different tools through', () => {
    const handler = handlerOf()
    for (let i = 0; i < 10; i++) expect(handler({ name: 'read_file', args: { path: `${i}` } })).toBeUndefined()
    for (let i = 0; i < 3; i++) expect(handler({ name: 'list_dir', args: { path: 'a' } })).toBeUndefined()
  })

  it('forgets calls that left the window', () => {
    const handler = handlerOf({ limit: 2, window: 3 })
    const same = { name: 'x', args: {} }
    handler(same)
    handler(same)
    for (let i = 0; i < 3; i++) handler({ name: 'y', args: i })
    expect(handler(same)).toBeUndefined()
  })
})
