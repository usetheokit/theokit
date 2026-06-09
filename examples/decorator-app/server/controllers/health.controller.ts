import { Controller, Get } from '@theokit/http-decorators'

/**
 * HealthController — simple health check endpoint.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      app: 'TheoKit Decorator App',
      version: '1.0.0',
      framework: {
        name: 'TheoKit',
        decorators: '@theokit/http-decorators v0.1.0',
        di: '@theokit/di v0.1.0',
      },
    }
  }
}
