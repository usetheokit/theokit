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
}

/**
 * Normalize a joined path: strip doubles, trim trailing, ensure leading.
 * (EC-3)
 */
export function joinPath(prefix: string, path: string): string {
  return ('/' + prefix + '/' + path).replace(/\/+/g, '/').replace(/\/$/, '') || '/'
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

  return methods.map((m) => {
    const paramEntries = paramsMap.get(m.propertyKey) ?? []

    // Resolve body/query/params schemas from design:paramtypes + DTO static schema (Pattern D2)
    const paramTypes: Function[] =
      Reflect.getMetadata('design:paramtypes', ControllerClass.prototype, m.propertyKey) ?? []

    // EC-4: detect missing emitDecoratorMetadata when WHOLE-OBJECT DTO injection is used
    // Only @Body() / @Query() WITHOUT a key need design:paramtypes for DTO class resolution.
    // @Param('id'), @Query('name') etc. use key-based extraction — no type metadata needed.
    const needsTypeResolution = paramEntries.some(
      (p) => (p.source === 'body' || p.source === 'query') && !p.key,
    )
    if (needsTypeResolution && paramTypes.length === 0) {
      throw new HttpDecoratorsConfigError(
        `emitDecoratorMetadata not enabled in consumer tsconfig — ` +
          `method ${String(m.propertyKey)} on ${ControllerClass.name} has @Body/@Query/@Param ` +
          `decorators but design:paramtypes is empty. ` +
          `Add "emitDecoratorMetadata": true to your tsconfig.json compilerOptions.`,
      )
    }

    const bodyParam = paramEntries.find((p) => p.source === 'body' && !p.key)
    const bodySchema = bodyParam ? resolveDtoSchema(paramTypes[bodyParam.index]) : undefined

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
    }
  })
}
