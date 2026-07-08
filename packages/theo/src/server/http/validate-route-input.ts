/**
 * M33 — the SINGLE route-input validation pipeline, shared by the HTTP path (`web-handler.ts`
 * `runHandler`) and the in-process caller (`in-process-caller.ts` `callProcedure`).
 *
 * Both surfaces validate the same three channels (`query`/`body`/`params`) against the same
 * `RouteConfig` Zod schemas. Extracting the logic here means there is ONE validation pipeline
 * (no duplication, no drift) — each caller only differs in how it MAPS a failure: the HTTP path
 * emits a 400 Response, the in-process path throws a typed error.
 */
import type { z } from 'zod'

/** The three request-input channels a route may declare a Zod schema for. */
export type RouteInputChannel = 'query' | 'body' | 'params'

/**
 * The minimal structural shape the validator needs: the three optional channel schemas. Both
 * `RouteConfig` (the 5-arity generic contract) and `WebRouteHandlerConfig` (the Web runtime shape)
 * satisfy this — the validator depends only on the schemas, not the full route generic.
 */
export interface RouteInputSchemas {
  query?: z.ZodType
  body?: z.ZodType
  params?: z.ZodType
}

/** Raw (pre-validation) channel values. A channel absent from the config passes through unchanged. */
export interface RawRouteInput {
  query?: unknown
  body?: unknown
  params?: unknown
}

/** Discriminated result — each caller maps `ok:false` to its own surface (Response vs throw). */
export type RouteInputValidation =
  | { ok: true; query: unknown; body: unknown; params: unknown }
  | { ok: false; channel: RouteInputChannel; error: z.ZodError }

/**
 * Validate the three input channels against the route's declared Zod schemas. A channel with no
 * declared schema passes its raw value through. First failing channel short-circuits (query → body
 * → params order, matching `runHandler`).
 */
export function validateRouteInput(
  config: RouteInputSchemas,
  raw: RawRouteInput,
): RouteInputValidation {
  let query: unknown = raw.query
  if (config.query !== undefined) {
    const parsed = config.query.safeParse(raw.query)
    if (!parsed.success) return { ok: false, channel: 'query', error: parsed.error }
    query = parsed.data
  }
  let body: unknown = raw.body
  if (config.body !== undefined) {
    const parsed = config.body.safeParse(raw.body)
    if (!parsed.success) return { ok: false, channel: 'body', error: parsed.error }
    body = parsed.data
  }
  let params: unknown = raw.params
  if (config.params !== undefined) {
    const parsed = config.params.safeParse(raw.params)
    if (!parsed.success) return { ok: false, channel: 'params', error: parsed.error }
    params = parsed.data
  }
  return { ok: true, query, body, params }
}
