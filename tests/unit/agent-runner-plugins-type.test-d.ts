import { describe, expectTypeOf, it } from 'vitest'
import type { Plugin, PluginsSettings } from '@theokit/sdk'

import type { AgentRunnerRunOptions } from '../../packages/agents/src/loop/agent-runner.js'

/**
 * RADAR #90-B / #90.3 (agents-side) — `AgentRunnerRunOptions.plugins` widen.
 *
 * The field was typed `PluginsSettings` only, but the runtime forwards plugins
 * through a duck-typed `Agent.create` (`Record<string, unknown>`) and the SDK
 * runtime accepts a code `Plugin[]` (the @theokit/sdk #90.3a fix). Widening to
 * `PluginsSettings | readonly Plugin[]` lets consumers (TheoCode) pass a
 * `Plugin[]` without an `as unknown as PluginsSettings` cast.
 */
describe('AgentRunnerRunOptions.plugins (types)', () => {
  it('accepts a readonly Plugin[] (array of code Plugin objects)', () => {
    // RED before the widen: `readonly Plugin[]` does NOT extend `PluginsSettings`
    // (TS2559 — "Type 'Plugin[]' has no properties in common with PluginsSettings").
    expectTypeOf<readonly Plugin[]>().toExtend<NonNullable<AgentRunnerRunOptions['plugins']>>()
  })

  it('still accepts a PluginsSettings ({ enabled }) — backward-compat', () => {
    expectTypeOf<PluginsSettings>().toExtend<NonNullable<AgentRunnerRunOptions['plugins']>>()

    const settings: AgentRunnerRunOptions['plugins'] = { enabled: ['x'] }
    expectTypeOf(settings).toExtend<AgentRunnerRunOptions['plugins']>()
  })
})
