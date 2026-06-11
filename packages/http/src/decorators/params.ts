import type { z } from 'zod'

import { setMeta, getMeta, ROUTE_PARAMS } from '../metadata/index.js'

export type ParamSource =
  | 'req'
  | 'res'
  | 'body'
  | 'param'
  | 'query'
  | 'headers'
  | 'session'
  | 'ip'
  | 'host'

export interface ParamEntry {
  source: ParamSource
  key?: string
  index: number
  passthrough?: boolean
  /** Explicit Zod schema — when set, bypasses design:paramtypes + DTO resolution.
   *  Preferred path: `@Body(zMySchema)` works without emitDecoratorMetadata. */
  schema?: z.ZodType
}

/** Detect whether a value is a Zod schema (has `.safeParse()` method). */
function isZodSchema(v: unknown): v is z.ZodType {
  return (
    v !== null &&
    v !== undefined &&
    typeof v === 'object' &&
    typeof (v as Record<string, unknown>).safeParse === 'function'
  )
}

function makeParamDecorator(source: ParamSource) {
  /**
   * Overloaded parameter decorator:
   *  - `@Body()` / `@Param()` / `@Query()` — whole-object extraction
   *  - `@Body('key')` / `@Param('key')` — named-field extraction
   *  - `@Body(zodSchema)` — whole-object with explicit Zod validation
   *    (works WITHOUT emitDecoratorMetadata — TheoKit "Zod is SSoT" alignment)
   */
  return function (keyOrSchema?: string | z.ZodType): ParameterDecorator {
    return (target, propertyKey, parameterIndex) => {
      if (propertyKey === undefined) return
      const map =
        getMeta<Map<string | symbol, ParamEntry[]>>(ROUTE_PARAMS, target.constructor) ?? new Map()
      const entries = map.get(propertyKey) ?? []

      const entry: ParamEntry = { source, index: parameterIndex }
      if (typeof keyOrSchema === 'string') {
        entry.key = keyOrSchema
      } else if (isZodSchema(keyOrSchema)) {
        entry.schema = keyOrSchema
      }

      entries.push(entry)
      map.set(propertyKey, entries)
      setMeta(ROUTE_PARAMS, target.constructor, map)
    }
  }
}

export const Req = makeParamDecorator('req')
export const Body = makeParamDecorator('body')
export const Param = makeParamDecorator('param')
export const Query = makeParamDecorator('query')
export const Headers = makeParamDecorator('headers')
export const Session = makeParamDecorator('session')
export const Ip = makeParamDecorator('ip')
export const HostParam = makeParamDecorator('host')

export function Res(opts?: { passthrough?: boolean }): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey === undefined) return
    const map =
      getMeta<Map<string | symbol, ParamEntry[]>>(ROUTE_PARAMS, target.constructor) ?? new Map()
    const entries = map.get(propertyKey) ?? []
    entries.push({
      source: 'res',
      index: parameterIndex,
      passthrough: opts?.passthrough,
    })
    map.set(propertyKey, entries)
    setMeta(ROUTE_PARAMS, target.constructor, map)
  }
}
