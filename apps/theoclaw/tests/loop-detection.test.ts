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

describe('loop detection wiring', () => {
  it('the plugin agentToolOptions registers refuses a repeated call', async () => {
    const { makeHostToolsWorkspace } = await import('./host-tools-workspace.js')
    const { enforced } = await import('./tool-start-fixtures.js')
    const { resolveToolSettings } = await import('../src/tools/tool-settings.js')
    const { agentToolOptions } = await import('../src/tools/tool-registry.js')
    const workspace = makeHostToolsWorkspace()
    try {
      const settings = resolveToolSettings({}, workspace.path, { detect: enforced, warn: () => undefined })
      const plugin = agentToolOptions(settings).plugins.find((p) => p.name === 'theoclaw-loop-detection')
      let handler: Handler | undefined
      plugin?.register({ on: (_e: string, fn: Handler) => void (handler = fn) } as never)
      const call = { name: 'read_file', args: { path: 'a' } }
      const results = [1, 2, 3, 4].map(() => handler?.(call))
      expect(results[2]).toBeUndefined()
      expect(results[3]).toMatchObject({ block: true })
    } finally {
      workspace.remove()
    }
  })
})
