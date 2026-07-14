import 'reflect-metadata'
import { describe, it, expect } from 'vitest'

import { Controller } from '../../src/decorators/controller.js'
import { Get } from '../../src/decorators/methods.js'
import { Expose } from '../../src/decorators/expose.js'
import { UseGuards } from '../../src/decorators/middleware.js'
import { walkControllerMetadata } from '../../src/bridge/walk-metadata.js'

/**
 * M47 (ADR-M47-1) — `walkControllerMetadata` surfaces `@Expose`-bound members as agent-serving
 * `WalkResult`s (verb POST, path derived from the controller prefix + member name, `agent` populated), so
 * the dispatcher delegates them to `mountAgent`. Normal verb routes keep `agent` undefined (back-compat).
 */
describe('M47 — walkControllerMetadata surfaces @Expose bindings', () => {
  const fakeAgent = { __agent: true } as const

  it('test_walk_marks_agent_bound_member', () => {
    @Controller('api/agents')
    class AgentsController {
      @Expose(fakeAgent, { csrf: true })
      chat!: unknown
    }
    const results = walkControllerMetadata(AgentsController)
    const agentRoute = results.find((r) => r.agent !== undefined)
    expect(agentRoute).toBeDefined()
    expect(agentRoute!.agent).toEqual({ module: fakeAgent, opts: { csrf: true } })
    expect(agentRoute!.verb).toBe('POST')
    expect(agentRoute!.fullPath).toBe('/api/agents/chat')
    expect(agentRoute!.propertyKey).toBe('chat')
  })

  it('test_walk_expose_honors_explicit_path_option', () => {
    @Controller('api/agents')
    class AgentsController {
      @Expose(fakeAgent, { path: 'support-bot' })
      support!: unknown
    }
    const [route] = walkControllerMetadata(AgentsController).filter((r) => r.agent)
    expect(route.fullPath).toBe('/api/agents/support-bot')
  })

  it('test_walk_expose_composes_class_and_member_guards', () => {
    const guardA = () => true
    const guardB = () => true
    @Controller('api/agents')
    @UseGuards(guardA)
    class AgentsController {
      @Expose(fakeAgent)
      @UseGuards(guardB)
      chat!: unknown
    }
    const [route] = walkControllerMetadata(AgentsController).filter((r) => r.agent)
    expect(route.guards).toEqual([guardA, guardB])
  })

  it('test_walk_normal_verb_route_has_undefined_agent', () => {
    @Controller('api/things')
    class ThingsController {
      @Get()
      list() {
        return []
      }
    }
    const [route] = walkControllerMetadata(ThingsController)
    expect(route.agent).toBeUndefined()
    expect(route.verb).toBe('GET')
  })
})
