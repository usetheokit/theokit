/**
 * @Throttle() + @SkipThrottle() — NestJS-style rate limiting decorators.
 *
 * Thin bridge over @theokit/plugin-rate-limit. These decorators store
 * metadata that the rate-limit plugin reads at request time to override
 * or skip the global throttle config per route/controller.
 *
 * Usage:
 * ```ts
 * @Controller('api/tasks')
 * @Throttle({ limit: 100, ttl: 60_000 }) // 100 req/min for all routes
 * class TasksController {
 *   @Get()
 *   @SkipThrottle()  // no rate limit on this route
 *   health() { return { ok: true } }
 *
 *   @Post()
 *   @Throttle({ limit: 5, ttl: 60_000 })  // stricter: 5 req/min
 *   create(@Body(schema) body) { ... }
 * }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const THROTTLE_KEY = Symbol.for('theokit:http-decorators:throttle')
const SKIP_THROTTLE_KEY = Symbol.for('theokit:http-decorators:skip-throttle')

export interface ThrottleOptions {
  /** Maximum requests within the TTL window. */
  limit: number
  /** Time-to-live in milliseconds. */
  ttl: number
  /** Optional throttle set name (for multiple throttler definitions). */
  name?: string
}

/**
 * Override the global rate limit for a controller or specific route.
 * NestJS equivalent: `@Throttle({ default: { limit, ttl } })`.
 */
export function Throttle(options: ThrottleOptions): ClassDecorator & MethodDecorator {
  return (target: object, propertyKey?: string | symbol) => {
    const actualTarget = propertyKey !== undefined ? target.constructor : target
    setMeta(THROTTLE_KEY, actualTarget, options, propertyKey)
  }
}

/**
 * Skip rate limiting for a controller or specific route.
 * NestJS equivalent: `@SkipThrottle()`.
 *
 * @param skip — defaults to `true`. Pass `false` to re-enable on a
 * specific route inside a skipped controller.
 */
export function SkipThrottle(skip = true): ClassDecorator & MethodDecorator {
  return (target: object, propertyKey?: string | symbol) => {
    const actualTarget = propertyKey !== undefined ? target.constructor : target
    setMeta(SKIP_THROTTLE_KEY, actualTarget, skip, propertyKey)
  }
}

/**
 * Read throttle metadata for a given class or method.
 * Used by the rate-limit plugin to resolve per-route overrides.
 */
export function getThrottleOptions(
  target: Function,
  propertyKey?: string | symbol,
): ThrottleOptions | undefined {
  return getMeta<ThrottleOptions>(THROTTLE_KEY, target, propertyKey)
}

/**
 * Check if throttling is skipped for a given class or method.
 */
export function isThrottleSkipped(target: Function, propertyKey?: string | symbol): boolean {
  return getMeta<boolean>(SKIP_THROTTLE_KEY, target, propertyKey) ?? false
}
