/**
 * FormData → ZodObject coercion driven by the declared schema.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 1 / T1.3 + Astro
 * runtime/server.ts:323-397 pattern (adapted to zod v3 shape access via
 * `_def.shape()`). FormData entries arrive as strings (or File for binary);
 * we walk the schema field-by-field and coerce to the declared zod type
 * before letting `safeParse` finalize validation.
 *
 * Supports: ZodString, ZodNumber, ZodBoolean, ZodArray (via getAll), nested
 * ZodObject (via dot-notation prefix), ZodOptional / ZodNullable / ZodDefault
 * wrappers. Skips: ZodDiscriminatedUnion + ZodPipe + ZodIntersection (deferred
 * to consumer's safeParse fallback — values returned as-is, zod will validate
 * or coerce).
 */
import { z } from 'zod'

/**
 * Walk the declared ZodObject schema and pull values from `formData`,
 * coercing per-field. Returns a plain object suitable for `schema.safeParse`.
 *
 * `prefix` is used for recursive nested-object resolution: a nested field at
 * `user.address.zip` is read from formData key `user.address.zip` (top-level
 * call uses empty prefix).
 */
export function formDataToObject(
  formData: FormData,
  schema: z.ZodObject<z.ZodRawShape>,
  prefix = '',
): Record<string, unknown> {
  const shape = schema._def.shape()
  const out: Record<string, unknown> = {}

  for (const [key, rawValidator] of Object.entries(shape)) {
    const fullKey = prefix + key
    const validator = unwrapWrappers(rawValidator)

    if (validator instanceof z.ZodObject) {
      // Recurse for nested object types
      const nestedPrefix = `${fullKey}.`
      const hasNestedKeys = [...formData.keys()].some((k) => k.startsWith(nestedPrefix))
      if (hasNestedKeys) {
        out[key] = formDataToObject(formData, validator as z.ZodObject<z.ZodRawShape>, nestedPrefix)
        continue
      }
      // No nested keys present — apply default / nullable / undefined semantics
      out[key] = unwrapMissingDefault(rawValidator)
      continue
    }

    if (validator instanceof z.ZodArray) {
      const values = formData.getAll(fullKey)
      out[key] = coerceArrayElements(values, validator as z.ZodArray<z.ZodTypeAny>)
      continue
    }

    if (validator instanceof z.ZodBoolean) {
      out[key] = coerceBoolean(formData, fullKey)
      continue
    }

    // Scalar (string / number / etc.)
    if (formData.has(fullKey)) {
      const raw = formData.get(fullKey)
      out[key] = coerceScalar(raw, validator)
    } else {
      out[key] = unwrapMissingDefault(rawValidator)
    }
  }

  return out
}

/** Strip ZodOptional / ZodNullable / ZodDefault to reach the inner validator. */
function unwrapWrappers(validator: z.ZodTypeAny): z.ZodTypeAny {
  let inner: z.ZodTypeAny = validator
  while (
    inner instanceof z.ZodOptional ||
    inner instanceof z.ZodNullable ||
    inner instanceof z.ZodDefault
  ) {
    inner = (inner._def as { innerType: z.ZodTypeAny }).innerType
  }
  return inner
}

/**
 * What to return when a field is missing from FormData:
 *  - ZodDefault → the default value (evaluated if function)
 *  - ZodNullable → null
 *  - ZodOptional → undefined
 *  - else → undefined (consumer safeParse will likely error)
 */
function unwrapMissingDefault(validator: z.ZodTypeAny): unknown {
  let cursor: z.ZodTypeAny = validator
  while (
    cursor instanceof z.ZodOptional ||
    cursor instanceof z.ZodNullable ||
    cursor instanceof z.ZodDefault
  ) {
    if (cursor instanceof z.ZodDefault) {
      const def = (cursor._def as { defaultValue: unknown }).defaultValue
      return typeof def === 'function' ? (def as () => unknown)() : def
    }
    if (cursor instanceof z.ZodNullable) return null
    cursor = (cursor._def as { innerType: z.ZodTypeAny }).innerType
  }
  return undefined
}

function coerceScalar(raw: FormDataEntryValue | null, validator: z.ZodTypeAny): unknown {
  if (raw === null) return undefined
  if (validator instanceof z.ZodNumber) {
    return typeof raw === 'string' ? Number(raw) : raw
  }
  // String, File, default — pass through (zod will validate File via .instanceof if used)
  return raw
}

function coerceArrayElements(
  values: FormDataEntryValue[],
  arrayValidator: z.ZodArray<z.ZodTypeAny>,
): unknown[] {
  const elementType = unwrapWrappers(arrayValidator._def.type)
  if (elementType instanceof z.ZodNumber) {
    return values.map((v) => (typeof v === 'string' ? Number(v) : v))
  }
  if (elementType instanceof z.ZodBoolean) {
    return values.map((v) => {
      if (v === 'true') return true
      if (v === 'false') return false
      return Boolean(v)
    })
  }
  // String / File / unknown — pass through
  return values
}

function coerceBoolean(formData: FormData, key: string): boolean | undefined {
  if (!formData.has(key)) return undefined
  const val = formData.get(key)
  if (val === 'true') return true
  if (val === 'false') return false
  // Presence with truthy non-boolean string (e.g., HTML checkbox "on") → true
  return Boolean(val)
}
