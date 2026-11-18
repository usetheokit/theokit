/**
 * Encode values as FormData so `formDataToObject(result, schema)` on the server returns them.
 * The walk follows the Zod object schema (read structurally, by constructor name, so this module
 * never imports `zod` into browser bundles).
 */
export class FormDataEncodingError extends Error {
  readonly name = 'FormDataEncodingError'
  readonly code = 'form_data_unencodable'
  /** dot path of the field, e.g. 'items' */
  readonly path: string
  constructor(path: string, message: string) {
    super(message)
    this.path = path
  }
}

interface AnyDef {
  shape?: Record<string, unknown>
  innerType?: unknown
  element?: unknown
}

function ctorName(schema: unknown): string {
  return (schema as { constructor?: { name?: string } } | null)?.constructor?.name ?? ''
}

function defOf(schema: unknown): AnyDef {
  const s = schema as { def?: AnyDef; _def?: AnyDef }
  return s.def ?? s._def ?? {}
}

function unwrap(schema: unknown): unknown {
  let cur = schema
  for (;;) {
    const n = ctorName(cur)
    if (n !== 'ZodOptional' && n !== 'ZodNullable' && n !== 'ZodDefault') return cur
    const inner = defOf(cur).innerType
    if (!inner) return cur
    cur = inner
  }
}

function shapeOf(schema: unknown): Record<string, unknown> {
  const s = schema as { shape?: Record<string, unknown> }
  return s.shape ?? defOf(schema).shape ?? {}
}

function isBlob(v: unknown): v is Blob {
  return typeof Blob !== 'undefined' && v instanceof Blob
}

/** A browser FileList is array-like, not an Array. */
function asBlobList(v: unknown): Blob[] | undefined {
  if (isBlob(v)) return [v]
  if (v === null || typeof v !== 'object') return undefined
  const len = (v as { length?: unknown }).length
  if (typeof len !== 'number') return undefined
  const items = Array.from(v as ArrayLike<unknown>)
  return items.length > 0 && items.every(isBlob) ? items : undefined
}

function appendScalar(fd: FormData, key: string, v: unknown): void {
  if (isBlob(v)) fd.append(key, v)
  else if (typeof v === 'boolean') fd.append(key, v ? 'true' : 'false')
  else fd.append(key, String(v))
}

function appendValue(fd: FormData, key: string, schema: unknown, value: unknown): void {
  if (value === null || value === undefined) return
  const inner = unwrap(schema)
  const name = ctorName(inner)

  if (name === 'ZodObject') {
    if (typeof value !== 'object') return
    const before = Array.from(fd.keys()).length
    const obj = value as Record<string, unknown>
    appendObject(fd, `${key}.`, inner, obj)
    if (Array.from(fd.keys()).length === before) {
      throw new FormDataEncodingError(
        key,
        `Field '${key}' is a nested object that emits no entries; formDataToObject cannot read it back.`,
      )
    }
    return
  }

  if (name === 'ZodArray') {
    const element = defOf(inner).element
    const elementName = element ? ctorName(unwrap(element)) : ''
    if (elementName === 'ZodObject' || elementName === 'ZodArray') {
      throw new FormDataEncodingError(
        key,
        `Field '${key}' is an array of ${elementName === 'ZodObject' ? 'objects' : 'arrays'}; formDataToObject cannot read that back.`,
      )
    }
    const list = Array.isArray(value)
      ? value
      : (asBlobList(value) ?? Array.from(value as ArrayLike<unknown>))
    for (const item of list) {
      if (item !== null && item !== undefined) appendScalar(fd, key, item)
    }
    return
  }

  const files = asBlobList(value)
  if (files) {
    for (const f of files) fd.append(key, f)
    return
  }
  appendScalar(fd, key, value)
}

function appendObject(
  fd: FormData,
  prefix: string,
  schema: unknown,
  values: Record<string, unknown>,
): void {
  for (const [k, fieldSchema] of Object.entries(shapeOf(schema))) {
    appendValue(fd, prefix + k, fieldSchema, values[k])
  }
}

/**
 * Encode `values` as FormData so that `formDataToObject(result, schema)` returns the same values.
 * Throws FormDataEncodingError for a shape the decoder cannot read back (an array of objects).
 */
export function objectToFormData(values: Record<string, unknown>, schema: object): FormData {
  const fd = new FormData()
  appendObject(fd, '', schema, values)
  return fd
}
