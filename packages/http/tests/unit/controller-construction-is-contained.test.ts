/**
 * A controller whose constructor throws answers 500 for ITS routes — it does not take the process
 * down (usetheokit/theokit#577).
 *
 * Reported against a real app. One optional plugin's env var was unset, the app booted, logged
 * `plugin not registered: plugin-voice (OPENAI_API_KEY unset)` and `plugins registered: 2`, printed
 * its URL — and then exited on the first request to ANY route:
 *
 *   VoicePluginConfigError: Missing OPENAI_API_KEY for @theokit/plugin-voice STT
 *       at VoiceController.<instance_members_initializer> (server/controllers/voice.controller.ts:28)
 *       at resolveOrNew (@theokit/http)
 *       at createDecoratorHandler (@theokit/http)
 *       at async dispatchControllerRequest (theokit)
 *
 * Not a 500 for `/api/voice/*`. Process exit, from an unhandled rejection inside the dispatcher.
 *
 * The framework's half is the containment. `createDecoratorHandler` constructs every controller in
 * one loop before serving anything, so one class failing to build discards the handler for all of
 * them — including the routes that work. The operator had been told the plugin degraded gracefully;
 * it had deferred the failure to the first request and widened it from one route to the process.
 *
 * The principle is already written down in this codebase, beside `createFallbackStream`:
 *
 *   > the app still boots and the gap is visible at the first call rather than at mount
 *
 * Visible at the first call, not fatal at the first call — and to one route, not to every one.
 */
import { describe, expect, it, vi } from 'vitest'

import { Controller, Get } from '../../src/index.js'
import { createDecoratorHandler } from '../../src/bridge/create-server.js'

class ConfigMissing extends Error {
  constructor() {
    super('Missing OPENAI_API_KEY for @theokit/plugin-voice STT (provider=openai)')
    this.name = 'VoicePluginConfigError'
  }
}

@Controller('voice')
class BrokenController {
  // A field initializer, which is where the reported crash lived: it runs at construction, and the
  // dispatcher constructs lazily per request — so the throw lands inside request dispatch.
  private readonly config = ((): string => {
    throw new ConfigMissing()
  })()

  @Get('stt')
  transcribe(): { ok: boolean } {
    return { ok: this.config !== '' }
  }
}

@Controller('health')
class HealthyController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' }
  }
}

describe('a throwing controller constructor is contained (#577)', () => {
  it('does not throw while building the handler', () => {
    // The first containment. Before this, the loop in createDecoratorHandler propagated, so the
    // handler never came into existence and the caller — the framework dispatcher — got the throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => createDecoratorHandler([BrokenController, HealthyController])).not.toThrow()
    spy.mockRestore()
  })

  it('serves every other controller normally', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handle = createDecoratorHandler([BrokenController, HealthyController])
    spy.mockRestore()

    return handle(new Request('http://x/health')).then(async (res) => {
      expect(res).not.toBeNull()
      expect(res!.status).toBe(200)
      expect(await res!.json()).toEqual({ status: 'ok' })
    })
  })

  it('answers 500 for the broken controller, naming the construction error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handle = createDecoratorHandler([BrokenController, HealthyController])
    spy.mockRestore()

    const res = await handle(new Request('http://x/voice/stt'))
    expect(res).not.toBeNull()
    expect(res!.status).toBe(500)

    const body = (await res!.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('CONTROLLER_CONSTRUCTION_FAILED')
    // The cause, not a generic apology: the operator must be able to act on it without a debugger.
    expect(body.error.message).toMatch(/OPENAI_API_KEY/u)
    expect(body.error.message).toMatch(/BrokenController/u)
  })

  it('reports the failure once at construction, not silently', async () => {
    // Containment is not swallowing. A 500 nobody looks at is exactly the silent failure this repo
    // refuses elsewhere — the error has to reach the log the operator is already reading.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createDecoratorHandler([BrokenController, HealthyController])

    const said = spy.mock.calls.map((c) => c.join(' ')).join('\n')
    spy.mockRestore()

    expect(said).toMatch(/BrokenController/u)
    expect(said).toMatch(/OPENAI_API_KEY/u)
  })

  it('still routes by path — a miss is still a miss', () => {
    // The load-bearing negative. Registering the broken controller's routes must not turn the
    // handler into one that answers everything; an unmatched path still falls through to the host.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handle = createDecoratorHandler([BrokenController, HealthyController])
    spy.mockRestore()

    expect(handle.matches('GET', '/voice/stt')).toBe(true)
    expect(handle.matches('GET', '/nothing/here')).toBe(false)
  })

  it('a healthy-only handler is untouched — no console noise, no 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handle = createDecoratorHandler([HealthyController])
    const noise = spy.mock.calls.length
    spy.mockRestore()

    expect(noise).toBe(0)
    expect((await handle(new Request('http://x/health')))!.status).toBe(200)
  })
})
