import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { UseGuards, UseInterceptors } from '../../src/decorators/middleware.js'
import { getMeta, USE_GUARDS, USE_INTERCEPTORS } from '../../src/metadata/index.js'
import { Get } from '../../src/decorators/methods.js'

class AuthGuard {
  canActivate() {
    return true
  }
}
class RoleGuard {
  canActivate() {
    return true
  }
}
class LogInterceptor {
  intercept() {}
}

describe('T4.1 — @UseGuards + @UseInterceptors decorators', () => {
  it('test_use_guards_class_level', () => {
    @UseGuards(AuthGuard)
    class Ctrl {}
    const guards = getMeta<Function[]>(USE_GUARDS, Ctrl)
    expect(guards).toEqual([AuthGuard])
  })

  it('test_use_guards_method_level', () => {
    class Ctrl {
      @UseGuards(AuthGuard)
      @Get()
      handler() {}
    }
    const guards = getMeta<Function[]>(USE_GUARDS, Ctrl, 'handler')
    expect(guards).toEqual([AuthGuard])
  })

  it('test_use_guards_variadic_order_preserved', () => {
    class Ctrl {
      @UseGuards(AuthGuard, RoleGuard)
      @Get()
      handler() {}
    }
    const guards = getMeta<Function[]>(USE_GUARDS, Ctrl, 'handler')
    expect(guards).toEqual([AuthGuard, RoleGuard])
  })

  it('test_use_interceptors_class_level', () => {
    @UseInterceptors(LogInterceptor)
    class Ctrl {}
    const ints = getMeta<Function[]>(USE_INTERCEPTORS, Ctrl)
    expect(ints).toEqual([LogInterceptor])
  })

  it('test_use_interceptors_variadic', () => {
    class Ctrl {
      @UseInterceptors(LogInterceptor, AuthGuard)
      @Get()
      handler() {}
    }
    const ints = getMeta<Function[]>(USE_INTERCEPTORS, Ctrl, 'handler')
    expect(ints).toEqual([LogInterceptor, AuthGuard])
  })

  it('test_class_and_method_use_guards_compose (EC-9)', () => {
    @UseGuards(AuthGuard)
    class Ctrl {
      @UseGuards(RoleGuard)
      @Get()
      handler() {}
    }
    const classGuards = getMeta<Function[]>(USE_GUARDS, Ctrl) ?? []
    const methodGuards = getMeta<Function[]>(USE_GUARDS, Ctrl, 'handler') ?? []
    // Class-level stored on class; method-level stored on method key
    // Bridge must compose: class guards FIRST, then method guards (NestJS convention)
    expect(classGuards).toEqual([AuthGuard])
    expect(methodGuards).toEqual([RoleGuard])
  })
})
