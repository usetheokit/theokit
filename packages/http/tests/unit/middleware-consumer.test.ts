import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import {
  MiddlewareConsumerImpl,
  middlewareMatchesPath,
  runMiddleware,
  type NestMiddleware,
  type ResolvedMiddleware,
} from '../../src/bridge/middleware-consumer.js'

const fakeReq = new Request('http://localhost/tasks')

describe('T2.1 — MiddlewareConsumer builder', () => {
  it('test_consumer_apply_class_middleware', () => {
    class LoggerMiddleware implements NestMiddleware {
      use(_request: Request, next: () => Promise<Response | null>) {
        return next()
      }
    }
    const consumer = new MiddlewareConsumerImpl()
    consumer.apply(LoggerMiddleware).forRoutes('tasks')
    const entries = consumer.getEntries()

    expect(entries.length).toBe(1)
    expect(entries[0].routePatterns).toEqual(['tasks'])
    expect(typeof entries[0].handler).toBe('function')
  })

  it('test_consumer_apply_functional_middleware', () => {
    const logger = (_request: Request, next: () => Promise<Response | null>) => next()
    const consumer = new MiddlewareConsumerImpl()
    consumer.apply(logger).forRoutes('items')
    const entries = consumer.getEntries()

    expect(entries.length).toBe(1)
    expect(typeof entries[0].handler).toBe('function')
  })

  it('test_consumer_forRoutes_string', () => {
    const fn = (_request: Request, next: () => Promise<Response | null>) => next()
    const consumer = new MiddlewareConsumerImpl()
    consumer.apply(fn).forRoutes('cats', 'dogs')
    const entries = consumer.getEntries()

    expect(entries[0].routePatterns).toEqual(['cats', 'dogs'])
  })

  it('test_consumer_exclude', () => {
    const fn = (_request: Request, next: () => Promise<Response | null>) => next()
    const consumer = new MiddlewareConsumerImpl()
    consumer.apply(fn).exclude('cats/admin').forRoutes('cats')
    const entries = consumer.getEntries()

    expect(entries[0].excludePatterns).toEqual(['cats/admin'])
    expect(entries[0].routePatterns).toEqual(['cats'])
  })

  it('test_consumer_chain', () => {
    const a = (_request: Request, next: () => Promise<Response | null>) => next()
    const b = (_request: Request, next: () => Promise<Response | null>) => next()
    const consumer = new MiddlewareConsumerImpl()
    consumer.apply(a).forRoutes('x')
    consumer.apply(b).forRoutes('y')
    const entries = consumer.getEntries()

    expect(entries.length).toBe(2)
    expect(entries[0].routePatterns).toEqual(['x'])
    expect(entries[1].routePatterns).toEqual(['y'])
  })

  it('test_middleware_matches_route', () => {
    const entry: ResolvedMiddleware = {
      handler: (_request, next) => next(),
      routePatterns: ['api/v2/tasks'],
      excludePatterns: [],
    }
    expect(middlewareMatchesPath(entry, '/api/v2/tasks')).toBe(true)
    expect(middlewareMatchesPath(entry, '/api/v2/tasks/123')).toBe(true)
    expect(middlewareMatchesPath(entry, '/api/v2/users')).toBe(false)
  })

  it('test_middleware_excludes_route', () => {
    const entry: ResolvedMiddleware = {
      handler: (_request, next) => next(),
      routePatterns: ['api/v2/tasks'],
      excludePatterns: ['api/v2/tasks/stats'],
    }
    expect(middlewareMatchesPath(entry, '/api/v2/tasks')).toBe(true)
    expect(middlewareMatchesPath(entry, '/api/v2/tasks/123')).toBe(true)
    expect(middlewareMatchesPath(entry, '/api/v2/tasks/stats')).toBe(false)
  })

  it('test_middleware_wildcard_matches_all', () => {
    const entry: ResolvedMiddleware = {
      handler: (_request, next) => next(),
      routePatterns: ['*'],
      excludePatterns: [],
    }
    expect(middlewareMatchesPath(entry, '/anything')).toBe(true)
    expect(middlewareMatchesPath(entry, '/deep/nested/path')).toBe(true)
  })

  it('test_runMiddleware_executes_matching', async () => {
    const log: string[] = []
    const entries: ResolvedMiddleware[] = [
      {
        handler: (_request, next) => {
          log.push('middleware-ran')
          return next()
        },
        routePatterns: ['tasks'],
        excludePatterns: [],
      },
    ]
    const response = await runMiddleware(entries, fakeReq, '/tasks')
    expect(response).toBeNull() // null = not short-circuited
    expect(log).toEqual(['middleware-ran'])
  })

  it('test_runMiddleware_skips_non_matching', async () => {
    const log: string[] = []
    const entries: ResolvedMiddleware[] = [
      {
        handler: (_request, next) => {
          log.push('should-not-run')
          return next()
        },
        routePatterns: ['users'],
        excludePatterns: [],
      },
    ]
    await runMiddleware(entries, fakeReq, '/tasks')
    expect(log).toEqual([])
  })
})
