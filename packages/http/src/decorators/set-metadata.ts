/**
 * @SetMetadata + Reflector — NestJS-style custom metadata for guards.
 *
 * Enables role-based auth pattern:
 *   const Roles = createDecorator<string[]>()
 *   @Roles(['admin'])  →  guard reads via reflector.get(Roles, handler)
 */
import 'reflect-metadata'

/** Unique key type for type-safe metadata decorators. */
export type MetadataKey<T> = symbol & { __type?: T }

/**
 * Create a typed decorator that attaches metadata to a handler or class.
 * NestJS equivalent: `Reflector.createDecorator<T>()`.
 *
 * @example
 * ```ts
 * const Roles = createDecorator<string[]>()
 *
 * @Controller('cats')
 * class CatsController {
 *   @Post()
 *   @Roles(['admin'])
 *   create() { ... }
 * }
 * ```
 */
/** Monotonic counter for unique decorator keys — deterministic, no randomness. */
let decoratorKeyCounter = 0

export function createDecorator<T>(): (value: T) => MethodDecorator & ClassDecorator {
  const key = Symbol.for(`theokit:custom:${++decoratorKeyCounter}`) as MetadataKey<T>

  const decorator = (value: T): MethodDecorator & ClassDecorator => {
    return (target: object, propertyKey?: string | symbol) => {
      const metaTarget = propertyKey !== undefined ? target.constructor : target
      Reflect.defineMetadata(key, value, metaTarget, propertyKey as string)
    }
  }

  // Attach the key so Reflector can read it
  ;(decorator as unknown as { key: MetadataKey<T> }).key = key
  return decorator
}

/**
 * Low-level @SetMetadata decorator — attaches arbitrary metadata.
 * NestJS equivalent: `@SetMetadata(key, value)`.
 *
 * Prefer `createDecorator<T>()` for type-safe metadata.
 */
export function SetMetadata<T>(
  metaKey: string | symbol,
  value: T,
): MethodDecorator & ClassDecorator {
  return (target: object, propertyKey?: string | symbol) => {
    const metaTarget = propertyKey !== undefined ? target.constructor : target
    Reflect.defineMetadata(metaKey, value, metaTarget, propertyKey as string)
  }
}

/**
 * Reflector — reads metadata set by createDecorator or @SetMetadata.
 * NestJS-compatible Reflector with getAllAndOverride/getAllAndMerge.
 * HTTP-only per ADR D1.
 */
export class Reflector {
  /**
   * Read metadata set by a typed decorator created via createDecorator<T>().
   *
   * @example
   * ```ts
   * const Roles = createDecorator<string[]>()
   * const reflector = new Reflector()
   * const roles = reflector.get(Roles, handlerFn) // string[] | undefined
   * ```
   */
  get<T>(
    decorator: (value: T) => MethodDecorator & ClassDecorator,
    target: Function,
    propertyKey?: string | symbol,
  ): T | undefined {
    const key = (decorator as { key?: MetadataKey<T> }).key
    if (!key) return undefined
    if (propertyKey !== undefined) {
      return Reflect.getMetadata(key, target, propertyKey) as T | undefined
    }
    return Reflect.getMetadata(key, target) as T | undefined
  }

  /**
   * Read metadata set by @SetMetadata(key, value).
   */
  getByKey<T>(
    key: string | symbol,
    target: Function,
    propertyKey?: string | symbol,
  ): T | undefined {
    if (propertyKey !== undefined) {
      return Reflect.getMetadata(key, target, propertyKey) as T | undefined
    }
    return Reflect.getMetadata(key, target) as T | undefined
  }

  /**
   * Read metadata checking method-level first, then class-level.
   * Returns the first non-undefined value found.
   *
   * NestJS equivalent: `reflector.getAllAndOverride(ROLES_KEY, [context.getHandler(), context.getClass()])`
   *
   * @example
   * ```ts
   * const Roles = createDecorator<string[]>()
   * // In a guard:
   * const roles = reflector.getAllAndOverride(Roles, context.getClass(), context.getMethodName())
   * // Checks method-level @Roles first, falls back to class-level @Roles
   * ```
   */
  getAllAndOverride<T>(
    decorator: (value: T) => MethodDecorator & ClassDecorator,
    target: Function,
    propertyKey?: string | symbol,
  ): T | undefined {
    if (propertyKey !== undefined) {
      const methodLevel = this.get(decorator, target, propertyKey)
      if (methodLevel !== undefined) return methodLevel
    }
    return this.get(decorator, target)
  }

  /**
   * Read metadata checking method-level first, then class-level, by raw key.
   * Returns the first non-undefined value found.
   */
  getAllAndOverrideByKey<T>(
    key: string | symbol,
    target: Function,
    propertyKey?: string | symbol,
  ): T | undefined {
    if (propertyKey !== undefined) {
      const methodLevel = this.getByKey<T>(key, target, propertyKey)
      if (methodLevel !== undefined) return methodLevel
    }
    return this.getByKey<T>(key, target)
  }

  /**
   * Read metadata from both method-level and class-level, merging arrays.
   * Returns all found values as a flat array.
   *
   * NestJS equivalent: `reflector.getAllAndMerge(ROLES_KEY, [context.getHandler(), context.getClass()])`
   *
   * @example
   * ```ts
   * const Tags = createDecorator<string[]>()
   *
   * @Tags(['api'])
   * @Controller('cats')
   * class CatsCtrl {
   *   @Tags(['read'])
   *   @Get()
   *   findAll() {}
   * }
   *
   * reflector.getAllAndMerge(Tags, CatsCtrl, 'findAll')
   * // → ['read', 'api'] (method + class merged)
   * ```
   */
  getAllAndMerge<T>(
    decorator: (value: T) => MethodDecorator & ClassDecorator,
    target: Function,
    propertyKey?: string | symbol,
  ): T extends (infer U)[] ? U[] : T[] {
    const result: unknown[] = []
    if (propertyKey !== undefined) {
      const methodLevel = this.get(decorator, target, propertyKey)
      if (methodLevel !== undefined) {
        if (Array.isArray(methodLevel)) result.push(...methodLevel)
        else result.push(methodLevel)
      }
    }
    const classLevel = this.get(decorator, target)
    if (classLevel !== undefined) {
      if (Array.isArray(classLevel)) result.push(...classLevel)
      else result.push(classLevel)
    }
    return result as T extends (infer U)[] ? U[] : T[]
  }
}
