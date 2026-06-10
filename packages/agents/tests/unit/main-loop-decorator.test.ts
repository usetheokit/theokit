import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { MainLoop, getMainLoop } from '../../src/decorators/main-loop.js'
import { Agent } from '../../src/decorators/agent.js'

describe('@MainLoop decorator', () => {
  it('test_mainloop_stores_method_name', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const meta = getMainLoop(TestAgent)
    expect(meta).toBeDefined()
    expect(meta!.propertyKey).toBe('run')
  })

  it('test_mainloop_default_strategy', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getMainLoop(TestAgent)!.strategy).toBe('simple-chat')
  })

  it('test_mainloop_custom_strategy', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop({ strategy: 'plan-act-reflect', maxIterations: 5, timeoutMs: 10_000 })
      async run() {}
    }

    const meta = getMainLoop(TestAgent)!
    expect(meta.strategy).toBe('plan-act-reflect')
    expect(meta.maxIterations).toBe(5)
    expect(meta.timeoutMs).toBe(10_000)
  })

  it('test_only_one_mainloop_per_class_warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async first() {}

      @MainLoop()
      async second() {}
    }

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0]?.[0]).toContain('Overwriting')
    // Last wins
    expect(getMainLoop(TestAgent)!.propertyKey).toBe('second')

    warnSpy.mockRestore()
  })

  it('test_no_mainloop_returns_undefined', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {}

    expect(getMainLoop(TestAgent)).toBeUndefined()
  })
})
