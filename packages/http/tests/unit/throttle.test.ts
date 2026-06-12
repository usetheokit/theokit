import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import {
  Throttle,
  SkipThrottle,
  getThrottleOptions,
  isThrottleSkipped,
} from '../../src/decorators/throttle.js'
import { Controller, Get, Post } from '../../src/index.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

describe.skipIf(!isVitest)('@Throttle + @SkipThrottle bridge decorators', () => {
  it('test_throttle_on_class_stores_options', () => {
    @Throttle({ limit: 100, ttl: 60_000 })
    @Controller('tasks')
    class Ctrl {
      @Get() list() {}
    }
    const opts = getThrottleOptions(Ctrl)
    expect(opts).toEqual({ limit: 100, ttl: 60_000 })
  })

  it('test_throttle_on_method_overrides_class', () => {
    @Throttle({ limit: 100, ttl: 60_000 })
    @Controller('items')
    class Ctrl {
      @Post()
      @Throttle({ limit: 5, ttl: 60_000 })
      create() {}

      @Get()
      list() {}
    }
    // Method-level override
    const methodOpts = getThrottleOptions(Ctrl, 'create')
    expect(methodOpts).toEqual({ limit: 5, ttl: 60_000 })

    // Class-level default (method without override)
    const classOpts = getThrottleOptions(Ctrl)
    expect(classOpts).toEqual({ limit: 100, ttl: 60_000 })
  })

  it('test_throttle_with_name', () => {
    @Controller('api')
    class Ctrl {
      @Get()
      @Throttle({ limit: 3, ttl: 1000, name: 'short' })
      burst() {}
    }
    const opts = getThrottleOptions(Ctrl, 'burst')
    expect(opts?.name).toBe('short')
  })

  it('test_skip_throttle_on_class', () => {
    @SkipThrottle()
    @Controller('health')
    class Ctrl {
      @Get() check() {}
    }
    expect(isThrottleSkipped(Ctrl)).toBe(true)
  })

  it('test_skip_throttle_on_method', () => {
    @Controller('tasks')
    class Ctrl {
      @Get()
      @SkipThrottle()
      health() {}

      @Post()
      create() {}
    }
    expect(isThrottleSkipped(Ctrl, 'health')).toBe(true)
    expect(isThrottleSkipped(Ctrl, 'create')).toBe(false)
  })

  it('test_skip_throttle_false_reenables', () => {
    @SkipThrottle()
    @Controller('mixed')
    class Ctrl {
      @Get()
      @SkipThrottle(false) // re-enable on this route
      important() {}

      @Get('other')
      skipped() {}
    }
    expect(isThrottleSkipped(Ctrl)).toBe(true) // class skipped
    expect(isThrottleSkipped(Ctrl, 'important')).toBe(false) // method re-enabled
  })

  it('test_no_throttle_returns_undefined', () => {
    @Controller('plain')
    class Ctrl {
      @Get() handler() {}
    }
    expect(getThrottleOptions(Ctrl)).toBeUndefined()
    expect(isThrottleSkipped(Ctrl)).toBe(false)
  })
})
