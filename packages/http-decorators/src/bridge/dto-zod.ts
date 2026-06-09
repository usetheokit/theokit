import type { ZodTypeAny } from 'zod'

/**
 * Resolves a Zod schema from a DTO class via the `static schema` convention (Pattern D2).
 * Returns undefined when the class doesn't carry a compatible schema.
 */
export function resolveDtoSchema(dtoClass: unknown): ZodTypeAny | undefined {
  if (typeof dtoClass !== 'function') return undefined
  const maybe = (dtoClass as unknown as Record<string, unknown>).schema
  if (
    maybe !== null &&
    maybe !== undefined &&
    typeof (maybe as Record<string, unknown>).safeParse === 'function'
  ) {
    return maybe as ZodTypeAny
  }
  return undefined
}
