/**
 * M33 Phase 1 — `callProcedure`, the in-process typed caller.
 *
 * The load-bearing seam for non-HTTP surfaces (TUI / Tauri / MCP-tools): invoke a route's shared
 * logic with STRUCTURED input, WITHOUT going through the HTTP transport (no URL/body parsing, no
 * middleware chain, no Response). It reuses the SAME Zod validation pipeline as the HTTP path
 * (`validateRouteInput`) so there is no drift, and reuses the SAME `config.response` server-fault
 * check. Failures throw typed errors (there is no HTTP status off-web).
 *
 * Prior art: tRPC `callProcedure` / `createCallerFactory`
 * (`.claude/knowledge-base/references/trpc/packages/server/src/unstable-core-do-not-import/router.ts:401,441`).
 *
 * Design (ADR-0044 / blueprint §5.4): the AUTHOR passes structured input `{query?, body?, params?}`
 * — never synthesizes a Request. A minimal in-process `Request` is provided to the handler ONLY so
 * handlers that read `request.headers`/`request.url` still work (opencode's proven pattern); the
 * input itself is NOT parsed from it.
 */
import type { z } from 'zod'

import type { RouteConfig } from '../../core/contracts/route-config.js'

import {
  validateRouteInput,
  type RawRouteInput,
  type RouteInputChannel,
} from './validate-route-input.js'

/** Structured input for an in-process procedure call — one object per declared channel. */
export type ProcedureInput = RawRouteInput

/**
 * Thrown when structured input fails the route's Zod validation. The in-process analog of the HTTP
 * 400 — carries the failing channel + the Zod issues (typed error, not a magic value; Rule 8).
 */
export class ProcedureInputError extends Error {
  readonly channel: RouteInputChannel
  readonly issues: z.core.$ZodIssue[]
  constructor(channel: RouteInputChannel, error: z.ZodError) {
    super(`Invalid ${channel} for in-process procedure call: ${error.message}`)
    this.name = 'ProcedureInputError'
    this.channel = channel
    this.issues = error.issues
  }
}

/**
 * Thrown when the handler's plain-object return drifts from `config.response` — a SERVER fault
 * (the handler violated its own declared contract), mirroring the HTTP path's 500 as a throw.
 */
export class ProcedureOutputError extends Error {
  readonly issues: z.core.$ZodIssue[]
  constructor(error: z.ZodError) {
    super(`In-process procedure output failed its response schema: ${error.message}`)
    this.name = 'ProcedureOutputError'
    this.issues = error.issues
  }
}

/** A minimal, stable in-process Request for handlers that read `request.*`. Never parsed for input. */
function inProcessRequest(): Request {
  return new Request('theo://in-process/procedure', { method: 'POST' })
}

/**
 * Invoke a route/procedure's handler in-process with structured, Zod-validated input.
 *
 * @param config  the `RouteConfig` (what `route().build()` produces).
 * @param input   structured `{query?, body?, params?}` — validated by the route's schemas.
 * @param ctx     the typed run-context the handler receives (built by the CALLER — a TUI/Tauri/MCP
 *                surface supplies its own ctx factory; there is no HTTP middleware chain here).
 * @returns       the handler's result (validated against `config.response` when declared).
 * @throws ProcedureInputError  on invalid structured input (the off-web analog of a 400).
 * @throws ProcedureOutputError on a handler output that drifts from `config.response` (server fault).
 */
export async function callProcedure(
  // Accept ANY RouteConfig regardless of its per-channel schema generics — a caller passes a concrete
  // `route().body(z.object(...)).build()` whose generics differ from the `ZodUndefined` defaults.
  config: RouteConfig<z.ZodType, z.ZodType, z.ZodType>,
  input: ProcedureInput = {},
  ctx?: unknown,
): Promise<unknown> {
  const validated = validateRouteInput(config, input)
  if (!validated.ok) throw new ProcedureInputError(validated.channel, validated.error)

  const result = await config.handler({
    query: validated.query,
    body: validated.body,
    params: validated.params,
    request: inProcessRequest(),
    ctx: ctx,
  })

  // Server-fault response validation (parity with the HTTP path) — only for plain values, and only
  // when a response schema is declared. `Response` instances are pass-through (unusual off-web).
  const responseSchema = config.response
  if (responseSchema !== undefined && !(result instanceof Response)) {
    const parsed = responseSchema.safeParse(result)
    if (!parsed.success) throw new ProcedureOutputError(parsed.error)
    return parsed.data
  }
  return result
}
