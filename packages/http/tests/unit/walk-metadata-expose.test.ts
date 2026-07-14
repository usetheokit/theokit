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
      @Expose(fakeAgent)
      chat!: unknown
    }
    const results = walkControllerMetadata(AgentsController)
    const agentRoute = results.find((r) => r.agent !== undefined)
    expect(agentRoute).toBeDefined()
    expect(agentRoute!.agent).toEqual({ module: fakeAgent, opts: {} })
    expect(agentRoute!.verb).toBe('POST')
    expect(agentRoute!.fullPath).toBe('/api/agents/chat')
    expect(agentRoute!.propertyKey).toBe('chat')
  })

  it('test_expose_served_path_equals_the_generated_handle_convention_route', () => {
    // BLOCKER guard (M47 review): the generated handle's runtime value is `agentHandle('/api/agents/<name>')`
    // (the agent's convention route). The @Expose served path is `prefix + propertyKey`. When @Expose sits
    // under `@Controller('api/agents')` on a property named after the agent (`chat` for `agents/chat.ts`),
    // the two are IDENTICAL — so `useAgent(chat)` hits the served URL. This test pins that identity, the
    // exact invariant broken by the removed `opts.path` override.
    const agentName = 'chat'
    const conventionHandlePath = `/api/agents/${agentName}` // what the codegen emits for agents/chat.ts
    @Controller('api/agents')
    class AgentsController {
      @Expose(fakeAgent)
      chat!: unknown // property named after the agent
    }
    const [route] = walkControllerMetadata(AgentsController).filter((r) => r.agent)
    expect(route.fullPath).toBe(conventionHandlePath)
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
