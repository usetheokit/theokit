import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Controller } from '../../src/decorators/controller.js'
import { Get } from '../../src/decorators/methods.js'
import { UseGuards, UseInterceptors } from '../../src/decorators/middleware.js'
import { walkControllerMetadata } from '../../src/bridge/walk-metadata.js'

class AuthGuard {
  canActivate() {
    return true
  }
}
class LogInterceptor {
  intercept() {}
}

describe('Pattern D3 — Guards/Interceptors as defineMiddleware wraps', () => {
  it('test_pattern_d3_use_guards_metadata_captured', () => {
    @Controller('secure')
    class SecureCtrl {
      @UseGuards(AuthGuard)
      @Get()
      handler() {
        return 'ok'
      }
    }
    const results = walkControllerMetadata(SecureCtrl)
    expect(results).toHaveLength(1)
    expect(results[0].guards).toContain(AuthGuard)
  })

  it('test_pattern_d3_use_interceptors_metadata_captured', () => {
    @Controller('logged')
    class LoggedCtrl {
      @UseInterceptors(LogInterceptor)
      @Get()
      handler() {
        return 'ok'
      }
    }
    const results = walkControllerMetadata(LoggedCtrl)
    expect(results[0].interceptors).toContain(LogInterceptor)
  })
})
