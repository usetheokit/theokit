import { describe, expect, it } from 'vitest'

import { assembleM8CreateOptions } from '../src/bridge/sdk-adapter-create-options.js'

/**
 * Regression: a per-run plugin override (the HITL gate) used to REPLACE the agent's own code plugins,
 * because the overrides object is spread AFTER the assembled options. Every `createToolHooksPlugin`
 * hook was silently dropped whenever HITL was active — a PreToolUse veto that never ran.
 */
describe('assembleM8CreateOptions — compiled.plugins', () => {
  it('projects the agent\'s code plugins into Agent.create options', () => {
    const plugin = { name: 'p1', version: '1.0.0', kind: 'general', register: () => {} }
    const { options } = assembleM8CreateOptions({ plugins: [plugin] } as never)
    expect(options.plugins).toEqual([plugin])
  })

  it('omits plugins when the agent declares none', () => {
    const { options } = assembleM8CreateOptions({} as never)
    expect(options.plugins).toBeUndefined()
  })
})
