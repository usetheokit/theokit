import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Hook, getHooks, getHooksByPoint } from '../../src/decorators/hook.js'

describe('@Hook decorator', () => {
  it('test_hook_stores_entry', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}

      @Hook('before:llm-call')
      async onBeforeLLM() {}
    }

    const hooks = getHooks(TestAgent)
    expect(hooks).toHaveLength(1)
    expect(hooks[0].point).toBe('before:llm-call')
    expect(hooks[0].propertyKey).toBe('onBeforeLLM')
  })

  it('test_multiple_hooks_accumulated', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}

      @Hook('before:llm-call')
      async injectContext() {}

      @Hook('after:tool-call')
      async trackCost() {}

      @Hook('on:iteration')
      async checkBudget() {}

      @Hook('on:complete')
      async logResult() {}

      @Hook('on:error')
      async handleError() {}
    }

    expect(getHooks(TestAgent)).toHaveLength(5)
  })

  it('test_get_hooks_by_point', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}

      @Hook('before:tool-call')
      async guardA() {}

      @Hook('before:tool-call')
      async guardB() {}

      @Hook('after:tool-call')
      async log() {}
    }

    const beforeTool = getHooksByPoint(TestAgent, 'before:tool-call')
    expect(beforeTool).toHaveLength(2)
    expect(beforeTool.map(h => h.propertyKey)).toEqual(['guardA', 'guardB'])

    const afterTool = getHooksByPoint(TestAgent, 'after:tool-call')
    expect(afterTool).toHaveLength(1)
  })

  it('test_all_hook_points', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}

      @Hook('before:llm-call') async a() {}
      @Hook('after:llm-call') async b() {}
      @Hook('before:tool-call') async c() {}
      @Hook('after:tool-call') async d() {}
      @Hook('on:iteration') async e() {}
      @Hook('on:complete') async f() {}
      @Hook('on:error') async g() {}
    }

    expect(getHooks(TestAgent)).toHaveLength(7)
  })

  it('test_no_hooks_returns_empty', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getHooks(TestAgent)).toEqual([])
    expect(getHooksByPoint(TestAgent, 'on:error')).toEqual([])
  })
})
