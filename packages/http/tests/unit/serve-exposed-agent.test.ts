import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'

import { Controller } from '../../src/decorators/controller.js'
import { Expose } from '../../src/decorators/expose.js'
import { UseGuards } from '../../src/decorators/middleware.js'
import { createDecoratorHandler } from '../../src/bridge/create-server.js'

/**
 * M47 (ADR-M47-1) — an `@Expose`-bound route is delegated to the injected `serveAgent` callback (theo
 * supplies a `mountAgent`-backed impl), NOT invoked as a JSON controller method. http stays agent-runtime
 * agnostic (G1/G2): it only calls the provided callback. Guards still run (G5 — shared guards).
 */
describe('M47 — createDecoratorHandler delegates @Expose routes to serveAgent', () => {
  const fakeAgent = { __agent: 'chat' } as const

  it('test_agent_route_delegates_to_serveAgent', async () => {
    @Controller('api/agents')
    class AgentsController {
      @Expose(fakeAgent)
      chat!: unknown
    }
    const serveAgent = vi.fn(async () => new Response('STREAM', { status: 200 }))
    const handle = createDecoratorHandler({ controllers: [AgentsController], serveAgent })

    const res = await handle(
      new Request('http://x/api/agents/chat', { method: 'POST', body: '{}' }),
    )
    expect(res?.status).toBe(200)
    expect(await res!.text()).toBe('STREAM')
    expect(serveAgent).toHaveBeenCalledTimes(1)
    // The callback receives the bound agent module + the request + the per-binding opts.
    const [mod, , opts] = serveAgent.mock.calls[0] as unknown as [unknown, Request, unknown]
    expect(mod).toBe(fakeAgent)
    expect(opts).toEqual({})
  })

  it('test_agent_route_runs_guards_before_serveAgent', async () => {
    class DenyGuard {
      canActivate() {
        return false
      }
    }
    @Controller('api/agents')
    class AgentsController {
      @Expose(fakeAgent)
      @UseGuards(DenyGuard)
      chat!: unknown
    }
    const serveAgent = vi.fn(async () => new Response('STREAM'))
    const handle = createDecoratorHandler({ controllers: [AgentsController], serveAgent })
    const res = await handle(
      new Request('http://x/api/agents/chat', { method: 'POST', body: '{}' }),
    )
    // Guard denied → 403-class response, serveAgent NEVER called.
    expect(res?.status).toBe(403)
    expect(serveAgent).not.toHaveBeenCalled()
  })

  it('test_agent_route_without_serveAgent_is_a_typed_config_error', async () => {
    @Controller('api/agents')
    class AgentsController {
      @Expose(fakeAgent)
      chat!: unknown
    }
    const handle = createDecoratorHandler([AgentsController]) // no serveAgent wired
    const res = await handle(
      new Request('http://x/api/agents/chat', { method: 'POST', body: '{}' }),
    )
    expect(res?.status).toBe(500)
    const bodyText = await res!.text()
    expect(bodyText).toContain('serveAgent')
  })

  it('test_normal_route_unaffected_by_serveAgent', async () => {
    @Controller('api/things')
    class ThingsController {
      list() {
        return { ok: true }
      }
    }
    // Even with serveAgent wired, a non-agent route is served normally.
    const serveAgent = vi.fn(async () => new Response('STREAM'))
    const handle = createDecoratorHandler({ controllers: [ThingsController], serveAgent })
    expect(handle.matches('POST', '/api/agents/chat')).toBe(false)
    expect(serveAgent).not.toHaveBeenCalled()
  })
})
