/**
 * applyDecorators() — compose multiple decorators into a single reusable decorator.
 *
 * NestJS-compatible utility. Enables creating "preset" decorators that bundle
 * common configurations (auth + throttle + trace + memory + ...) into one decorator.
 *
 * @example
 * ```ts
 * // Create a reusable preset
 * const ProductionAgent = (name: string, route: string) => applyDecorators(
 *   Agent({ name, route, model: 'claude-sonnet-4-5-20250929' }),
 *   UseGuards(AuthGuard, TenantGuard),
 *   Throttle({ limit: 30, ttl: 60_000 }),
 *   Budget({ maxCostUsd: 5.00 }),
 *   Trace(true),
 * )
 *
 * // Apply preset to any agent
 * @ProductionAgent('support', '/api/agents/support')
 * class SupportAgent {
 *   @MainLoop()
 *   async run() {}
 * }
 * ```
 */

type AnyDecorator = ClassDecorator | MethodDecorator | PropertyDecorator

/**
 * Compose multiple decorators into a single decorator.
 * Works for both class-level and method-level decorators.
 */
export function applyDecorators(
  ...decorators: AnyDecorator[]
): ClassDecorator & MethodDecorator {
  return (
    target: object | Function,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    for (const decorator of decorators) {
      if (propertyKey !== undefined && descriptor !== undefined) {
        // Method-level
        ;(decorator as MethodDecorator)(target, propertyKey, descriptor)
      } else {
        // Class-level
        ;(decorator as ClassDecorator)(target as Function)
      }
    }
  }
}
