import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { AgentBuilder } from '../src/bridge/agent-builder.js'
import { compileAgentDefinition, defineAgent } from '../src/bridge/define-agent.js'

/**
 * Hooks are converted into their transport plugin at COMPILE time — the layer every entry point
 * (builder `.hooks()`, `defineAgent({ hooks })`) converges on. Asserting on the compiled options is
 * therefore asserting on what actually reaches `Agent.create`, which is the only thing that can
 * make a hook fire. Asserting on the definition would pass even if the runtime never saw the hook.
 */
const pluginsOf = (def: unknown): Array<Record<string, unknown>> =>
  ((compileAgentDefinition(def as never) as unknown as Record<string, unknown>).plugins ??
    []) as Array<Record<string, unknown>>

const registered = (plugin: Record<string, unknown>): string[] => {
  const seen: string[] = []
  ;(plugin.register as (c: unknown) => void)({
    on: (n: string) => {
      seen.push(n)
    },
  })
  return seen
}

describe('AgentBuilder.create().hooks()', () => {
  it('reaches the compiled options as a code plugin the SDK will accept', () => {
    const a = AgentBuilder.create()
      .input(z.object({ m: z.string() }))
      .model('x')
      .hooks({ pre_tool_call: () => undefined })
      .build()
    const plugins = pluginsOf(a)
    expect(plugins).toHaveLength(1)
    expect(plugins[0]).toMatchObject({ name: 'theokit-builder-hooks', kind: 'general' })
  })

  it('registers every function-valued hook under its own event name', () => {
    const a = AgentBuilder.create()
      .input(z.object({ m: z.string() }))
      .model('x')
      .hooks({ pre_tool_call: () => undefined, on_session_start: () => {}, bogus: 'nope' })
      .build()
    expect(registered(pluginsOf(a)[0]!).sort((a: string, b: string) => a.localeCompare(b))).toEqual(
      ['on_session_start', 'pre_tool_call'],
    )
  })

  it('COMPOSES with plugins() — hooks and plugins are additive, not exclusive', () => {
    const mine = { name: 'mine', kind: 'general', register: () => {} }
    const a = AgentBuilder.create()
      .input(z.object({ m: z.string() }))
      .model('x')
      .plugins([mine])
      .hooks({ pre_tool_call: () => undefined })
      .build()
    expect(pluginsOf(a).map((p) => p.name)).toEqual(['mine', 'theokit-builder-hooks'])
  })

  it('a later hooks() call REPLACES the map rather than accumulating', () => {
    const a = AgentBuilder.create()
      .input(z.object({ m: z.string() }))
      .model('x')
      .hooks({ pre_tool_call: () => undefined })
      .hooks({ on_session_start: () => {} })
      .build()
    expect(pluginsOf(a)).toHaveLength(1)
    expect(registered(pluginsOf(a)[0]!)).toEqual(['on_session_start'])
  })

  it('adds no plugin when no hook is declared', () => {
    const a = AgentBuilder.create()
      .input(z.object({ m: z.string() }))
      .model('x')
      .hooks({})
      .build()
    expect(pluginsOf(a)).toHaveLength(0)
  })
})

describe('defineAgent({ hooks })', () => {
  // Regression: the conversion used to live on the builder only, so this path type-checked and
  // silently no-opped — a declared security gate that never registered.
  it('converts hooks on the defineAgent path too', () => {
    const a = defineAgent({ model: 'x', hooks: { pre_tool_call: () => undefined } })
    const plugins = pluginsOf(a)
    expect(plugins).toHaveLength(1)
    expect(registered(plugins[0]!)).toEqual(['pre_tool_call'])
  })

  it('leaves plugins untouched when no hooks are declared', () => {
    const mine = { name: 'mine', kind: 'general', register: () => {} }
    expect(pluginsOf(defineAgent({ model: 'x', plugins: [mine] })).map((p) => p.name)).toEqual([
      'mine',
    ])
  })
})
