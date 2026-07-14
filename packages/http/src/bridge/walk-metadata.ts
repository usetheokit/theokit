import 'reflect-metadata'
import type { z } from 'zod'

import type { ControllerMeta } from '../decorators/controller.js'
import type { ExposeEntry, ExposeOptions } from '../decorators/expose.js'
import type { RouteMethodEntry, HttpVerb } from '../decorators/methods.js'
import type { ParamEntry } from '../decorators/params.js'
import type { RedirectMeta } from '../decorators/response.js'
import {
  getMeta,
  CONTROLLER_PREFIX,
  EXPOSE_AGENT,
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
  bodySchema?: z.ZodType
  querySchema?: z.ZodType
  paramsSchema?: z.ZodType
  paramEntries: ParamEntry[]
  status?: number
  headers: [string, string][]
  redirect?: RedirectMeta
  guards: Function[]
  interceptors: Function[]
  filters: Function[]
  /**
   * M47 — set when the member is bound via `@Expose(agent, opts)`. The dispatcher delegates such routes to
   * the agent runtime (`mountAgent`) instead of invoking a JSON handler. `undefined` for normal verb routes.
   */
  agent?: { module: unknown; opts: ExposeOptions }
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
): z.ZodType | undefined {
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
    `[@theokit/http] method ${String(propertyKey)} on ` +
      `${ControllerClass.name}: @Body() without explicit schema and ` +
      `emitDecoratorMetadata is not active. Body will be passed raw (no validation). ` +
      `Fix: use @Body(zodSchema) for validation without metadata emission.`,
  )
  return undefined
}

/** WeakMap cache — metadata is immutable; walk once, reuse forever. */
const walkCache = new WeakMap<Function, WalkResult[]>()

/**
 * Walk all decorator metadata on a controller class and produce
 * a structured list of route descriptors. Memoized per class via WeakMap.
 */
export function walkControllerMetadata(ControllerClass: Function): WalkResult[] {
  const cached = walkCache.get(ControllerClass)
  if (cached) return cached
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
      `[@theokit/http] @Controller host '${host}' captured but enforcement deferred to v0.2.0`,
    )
  }

  const methods = getMeta<RouteMethodEntry[]>(ROUTE_METHODS, ControllerClass) ?? []
  const paramsMap =
    getMeta<Map<string | symbol, ParamEntry[]>>(ROUTE_PARAMS, ControllerClass) ?? new Map()

  // Class-level guards/interceptors
  const classGuards = getMeta<Function[]>(USE_GUARDS, ControllerClass) ?? []
  const classInterceptors = getMeta<Function[]>(USE_INTERCEPTORS, ControllerClass) ?? []
  const classFilters = getMeta<Function[]>(USE_FILTERS, ControllerClass) ?? []

  const result = methods.map((m) => {
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

  // M47 — @Expose-bound members have no verb decorator, so they are absent from `methods`. Produce an
  // agent-serving WalkResult per binding: verb POST (agents are POST), path = prefix + member name (this
  // MUST be the agent's convention route so the generated handle's path matches — see ExposeOptions), the
  // agent module carried for the dispatcher, guards composed class-first (G5 shared guards). Interceptors
  // do NOT run for agent routes — the dispatcher delegates straight to `mountAgent` before the interceptor
  // chain — so they are intentionally not collected here (documented on `@Expose`).
  const exposeEntries = getMeta<ExposeEntry[]>(EXPOSE_AGENT, ControllerClass) ?? []
  const agentResults: WalkResult[] = exposeEntries.map((e) => {
    const memberGuards = getMeta<Function[]>(USE_GUARDS, ControllerClass, e.propertyKey) ?? []
    const verb: HttpVerb = 'POST'
    return {
      verb,
      fullPath: joinPath(prefix, String(e.propertyKey)),
      propertyKey: e.propertyKey,
      paramEntries: [],
      headers: [],
      guards: [...classGuards, ...memberGuards],
      interceptors: [],
      filters: classFilters,
      agent: { module: e.agent, opts: e.opts },
    }
  })

  const all = [...result, ...agentResults]
  walkCache.set(ControllerClass, all)
  return all
}
