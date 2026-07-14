import 'reflect-metadata'

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { loadControllerWithSwc } from '../../packages/http/dist/index.js'
import { createControllerDispatcher } from '../../packages/theo/src/server/http/controller-dispatch.js'

/**
 * M47 (ADR-M47-1) — end-to-end wiring gate: a real `@Expose`-bound controller is scanned, swc-compiled
 * (the parameter/property decorator metadata esbuild drops), and dispatched — and the agent route is
 * delegated to the injected `serveAgent` (in production: `mountAgent`), while a normal route is served as a
 * JSON method. `serveAgent` is a deterministic fake here; the real `mountAgent`-over-OpenRouter path is
 * proven by the showcase dogfood (Phase 4). The fixture lives under `packages/theo/` so the swc-compiled
 * controller's bare imports (`@theokit/http`) resolve.
 */
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__expose_dispatch_e2e__')
const CONTROLLERS_DIR = join(TEST_ROOT, 'controllers')

const CONTROLLER_SRC = `
import 'reflect-metadata'
import { Controller, Get, Expose } from '@theokit/http'

const chatAgent = { __agent: 'chat' }

@Controller('api/agents')
export class AgentsController {
  @Expose(chatAgent)
  chat
}

@Controller('api/health')
export class HealthController {
  @Get()
  status() {
    return { ok: true }
  }
}
`

beforeAll(() => {
  mkdirSync(CONTROLLERS_DIR, { recursive: true })
  writeFileSync(join(CONTROLLERS_DIR, 'agents.controller.ts'), CONTROLLER_SRC)
})

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('M47 — @Expose route dispatches to serveAgent end-to-end (scan → swc → dispatch)', () => {
  it('test_exposed_agent_route_delegates_to_serveAgent', async () => {
    const serveAgent = vi.fn(async () => new Response('AGENT-STREAM', { status: 200 }))
    const dispatcher = await createControllerDispatcher({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
      serveAgent,
    })
    expect(dispatcher).not.toBeNull()

    const res = await dispatcher!.dispatch(
      new Request('http://x/api/agents/chat', { method: 'POST', body: '{}' }),
    )
    expect(res?.status).toBe(200)
    expect(await res!.text()).toBe('AGENT-STREAM')
    expect(serveAgent).toHaveBeenCalledTimes(1)
    // The bound agent module + the per-binding opts reach the callback.
    const [, , opts] = serveAgent.mock.calls[0] as unknown as [unknown, Request, unknown]
    expect(opts).toEqual({})
  })

  it('test_normal_route_served_as_method_not_agent', async () => {
    const serveAgent = vi.fn(async () => new Response('AGENT-STREAM'))
    const dispatcher = await createControllerDispatcher({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
      serveAgent,
    })
    const res = await dispatcher!.dispatch(new Request('http://x/api/health', { method: 'GET' }))
    expect(res?.status).toBe(200)
    expect(await res!.json()).toEqual({ ok: true })
    expect(serveAgent).not.toHaveBeenCalled()
  })

  it('test_agent_route_matches_probe_true', async () => {
    const dispatcher = await createControllerDispatcher({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
      serveAgent: async () => new Response(),
    })
    // The non-executing probe reports the agent route as owned (so the host CSRF gate fires for it).
    expect(dispatcher!.matches('POST', '/api/agents/chat')).toBe(true)
    expect(dispatcher!.matches('POST', '/api/nonexistent')).toBe(false)
  })
})
