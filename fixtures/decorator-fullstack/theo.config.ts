import { defineConfig } from 'theokit'
import { httpDecoratorsPlugin } from '../../packages/http-decorators/src/theokit-plugin.js'
import { LoggerMiddleware } from './server/middleware/logger.middleware.js'

export default defineConfig({
  plugins: [
    httpDecoratorsPlugin({
      // Mode 1: Glob-based lazy loading via @swc/core.
      controllersGlob: 'server/controllers/**/*.controller.ts',
      // NestJS-style middleware: LoggerMiddleware runs on /api/v2/tasks routes
      configure(consumer) {
        consumer.apply(LoggerMiddleware).forRoutes('api/v2/tasks')
      },
    }),
  ],
})
