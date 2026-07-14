import 'reflect-metadata'
import { describe, it, expect } from 'vitest'

import { Expose } from '../../src/decorators/expose.js'
import type { ExposeEntry } from '../../src/decorators/expose.js'
import { getMeta, EXPOSE_AGENT } from '../../src/metadata/index.js'

/**
 * M47 (ADR-M47-1) — `@Expose(agent, opts?)` binds a separately-built agent to a controller method/property,
 * storing metadata the walker turns into an agent-serving route. It mirrors the #122 verb decorators
 * (`@Post`) but stores the agent module + options instead of an HTTP verb.
 */
describe('M47 — @Expose decorator', () => {
  const fakeAgent = { __agent: true } as const

  it('test_expose_stores_agent_and_opts_in_metadata', () => {
    class AgentsController {
      @Expose(fakeAgent, { csrf: true })
      chat!: unknown
    }
    const entries = getMeta<ExposeEntry[]>(EXPOSE_AGENT, AgentsController)
    expect(entries).toBeDefined()
    expect(entries).toHaveLength(1)
    expect(entries![0]).toMatchObject({
      agent: fakeAgent,
      opts: { csrf: true },
      propertyKey: 'chat',
    })
  })

  it('test_expose_defaults_opts_to_empty_object', () => {
    class AgentsController {
      @Expose(fakeAgent)
      support!: unknown
    }
    const entries = getMeta<ExposeEntry[]>(EXPOSE_AGENT, AgentsController)
    expect(entries![0].opts).toEqual({})
    expect(entries![0].propertyKey).toBe('support')
  })

  it('test_expose_accumulates_multiple_bindings_on_one_controller', () => {
    class MultiController {
      @Expose(fakeAgent)
      chat!: unknown
      @Expose(fakeAgent, { csrf: false })
      other!: unknown
    }
    const entries = getMeta<ExposeEntry[]>(EXPOSE_AGENT, MultiController)
    expect(entries).toHaveLength(2)
    expect(entries!.map((e) => e.propertyKey)).toEqual(['chat', 'other'])
  })
})
