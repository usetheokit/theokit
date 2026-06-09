import 'reflect-metadata'
import type { ZodTypeAny } from 'zod'

import type { ControllerMeta } from '../decorators/controller.js'
import type { RouteMethodEntry, HttpVerb } from '../decorators/methods.js'
import type { ParamEntry } from '../decorators/params.js'
import type { RedirectMeta } from '../decorators/response.js'
import {
  getMeta,
  CONTROLLER_PREFIX,
  ROUTE_METHODS,
  ROUTE_PARAMS,
  ROUTE_STATUS,
  ROUTE_HEADERS,
  ROUTE_REDIRECT,
  USE_GUARDS,
  USE_INTERCEPTORS,
  USE_FILTERS,
} from '../metadata/index.js'

import { resolveDtoSchema } from './dto-zod.js'
import { HttpDecoratorsConfigError } from './errors.js'

export interface WalkResult {
  verb: HttpVerb
  fullPath: string
  propertyKey: string | symbol
  bodySchema?: ZodTypeAny
  querySchema?: ZodTypeAny
  paramsSchema?: ZodTypeAny
  paramEntries: ParamEntry[]
  status?: number
  headers: [string, string][]
  redirect?: RedirectMeta
  guards: Function[]
  interceptors: Function[]
  filters: Function[]
}

/**
 * Normalize a joined path: strip doubles, trim trailing, ensure leading.
 * (EC-3)
 */
export function joinPath(prefix: string, path: string): string {
  return ('/' + prefix + '/' + path).replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

/**
 * Resolve the Zod body schema for a method's @Body() param entry.
 *
 * Priority: explicit @Body(zodSchema) > design:paramtypes + DTO static schema.
 * EC-4 relaxed: warns (not throws) when paramtypes missing — @Body(zodSchema) is the fix.
 */
function resolveBodySchema(
  paramEntries: ParamEntry[],
  ControllerClass: Function,
  propertyKey: string | symbol,
): ZodTypeAny | undefined {
  const bodyParam = paramEntries.find((p) => p.source === 'body' && !p.key)
  if (!bodyParam) return undefined

  // Priority 1: explicit Zod schema from @Body(zodSchema)
  if (bodyParam.schema) return bodyParam.schema

  // Priority 2: design:paramtypes + DTO static schema (requires emitDecoratorMetadata)
  const paramTypes: Function[] =
    Reflect.getMetadata('design:paramtypes', ControllerClass.prototype, propertyKey) ?? []
  if (paramTypes.length > 0) {
    return resolveDtoSchema(paramTypes[bodyParam.index])
  }

  // EC-4 relaxed: warn when @Body() has no schema and no paramtypes
  console.warn(
    `[@theokit/http-decorators] method ${String(propertyKey)} on ` +
      `${ControllerClass.name}: @Body() without explicit schema and ` +
      `emitDecoratorMetadata is not active. Body will be passed raw (no validation). ` +
      `Fix: use @Body(zodSchema) for validation without metadata emission.`,
  )
  return undefined
}

/**
 * Walk all decorator metadata on a controller class and produce
 * a structured list of route descriptors. Pure function — no side effects.
 */
export function walkControllerMetadata(ControllerClass: Function): WalkResult[] {
  // EC-2: throw when @Controller decorator is missing
  const controllerMeta = getMeta<ControllerMeta>(CONTROLLER_PREFIX, ControllerClass)
  if (!controllerMeta) {
    throw new HttpDecoratorsConfigError(
      `Controller class ${ControllerClass.name} is missing @Controller() decorator. ` +
        `Add @Controller('prefix') to the class declaration.`,
    )
  }
  const { prefix, host } = controllerMeta

  // Q4: host captured but enforcement deferred to v0.2.0
  if (host) {
    console.warn(
      `[@theokit/http-decorators] @Controller host '${host}' captured but enforcement deferred to v0.2.0`,
    )
  }

  const methods = getMeta<RouteMethodEntry[]>(ROUTE_METHODS, ControllerClass) ?? []
  const paramsMap =
    getMeta<Map<string | symbol, ParamEntry[]>>(ROUTE_PARAMS, ControllerClass) ?? new Map()

  // Class-level guards/interceptors
  const classGuards = getMeta<Function[]>(USE_GUARDS, ControllerClass) ?? []
  const classInterceptors = getMeta<Function[]>(USE_INTERCEPTORS, ControllerClass) ?? []
  const classFilters = getMeta<Function[]>(USE_FILTERS, ControllerClass) ?? []

  return methods.map((m) => {
    const paramEntries = paramsMap.get(m.propertyKey) ?? []
    const bodySchema = resolveBodySchema(paramEntries, ControllerClass, m.propertyKey)

    // Method-level guards/interceptors (composed: class FIRST per NestJS convention — EC-9)
    const methodGuards = getMeta<Function[]>(USE_GUARDS, ControllerClass, m.propertyKey) ?? []
    const methodInterceptors =
      getMeta<Function[]>(USE_INTERCEPTORS, ControllerClass, m.propertyKey) ?? []

    return {
      verb: m.verb,
      fullPath: joinPath(prefix, m.path),
      propertyKey: m.propertyKey,
      bodySchema,
      paramEntries: [...paramEntries].sort((a, b) => a.index - b.index),
      status: getMeta<number>(ROUTE_STATUS, ControllerClass, m.propertyKey),
      headers: getMeta<[string, string][]>(ROUTE_HEADERS, ControllerClass, m.propertyKey) ?? [],
      redirect: getMeta<RedirectMeta>(ROUTE_REDIRECT, ControllerClass, m.propertyKey),
      guards: [...classGuards, ...methodGuards],
      interceptors: [...classInterceptors, ...methodInterceptors],
      filters: getMeta<Function[]>(USE_FILTERS, ControllerClass, m.propertyKey) ?? classFilters,
    }
  })
}
