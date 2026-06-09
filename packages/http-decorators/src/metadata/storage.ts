import 'reflect-metadata'

/**
 * Typed facade over Reflect.defineMetadata / Reflect.getMetadata.
 * Centralizes all reflect-metadata calls so decorators + bridge
 * never call Reflect.* directly (single import point for the polyfill).
 */

export function setMeta<T>(
  key: symbol,
  target: object,
  value: T,
  propertyKey?: string | symbol,
): void {
  if (propertyKey !== undefined) {
    Reflect.defineMetadata(key, value, target, propertyKey)
  } else {
    Reflect.defineMetadata(key, value, target)
  }
}

export function getMeta<T>(
  key: symbol,
  target: object,
  propertyKey?: string | symbol,
): T | undefined {
  if (propertyKey !== undefined) {
    return Reflect.getMetadata(key, target, propertyKey) as T | undefined
  }
  return Reflect.getMetadata(key, target) as T | undefined
}
