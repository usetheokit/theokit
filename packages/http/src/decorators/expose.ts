import { setMeta, getMeta, EXPOSE_AGENT } from '../metadata/index.js'

/**
 * M47 (ADR-M47-1) — `@Expose(agent, opts?)` binds a SEPARATELY-BUILT agent (a pure `agent()…build()` from
 * `agents/<name>.ts`) to a controller method/property, making the exposure (route, auth, csrf, streaming)
 * visible in one code review. It mirrors the #122 verb decorators (`@Post`) — storing metadata via the same
 * `Symbol.for()` seam — but records the agent + options instead of an HTTP verb, so the controller walker
 * turns the method into an agent-serving route delegated to the ONE runtime (`mountAgent`), never a JSON
 * handler. It is a new AUTHORING surface over the existing runtime, not a parallel runtime (G2).
 */

/** Per-binding options for an exposed agent. `csrf` toggles the shared CSRF gate (web surface). */
export interface ExposeOptions {
  /** Enforce the CSRF gate on the HTTP route (default follows the app config). */
  csrf?: boolean
  /** Override the derived path (default: the controller prefix + property name). */
  path?: string
}

/** Metadata recorded per `@Expose`-decorated controller member. */
export interface ExposeEntry {
  /** The separately-built agent module bound to this member. */
  agent: unknown
  /** The per-binding options (defaulted to `{}`). */
  opts: ExposeOptions
  /** The controller member the binding is attached to. */
  propertyKey: string | symbol
}

/**
 * Bind an agent to a controller PROPERTY. Accumulates one {@link ExposeEntry} per member under the
 * `EXPOSE_AGENT` metadata key on the controller constructor — the same accumulation shape `@Post` uses for
 * `ROUTE_METHODS`, so `walkControllerMetadata` reads both alongside each other. Typed as `PropertyDecorator`
 * (the exposure is declared as a property, e.g. `@Expose(chatAgent) chat!: typeof chatAgent`); the agent's
 * behavior lives in its own `agents/<name>.ts`, never in a controller method body.
 */
export function Expose(agent: unknown, opts: ExposeOptions = {}): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing = getMeta<ExposeEntry[]>(EXPOSE_AGENT, target.constructor) ?? []
    existing.push({ agent, opts, propertyKey })
    setMeta(EXPOSE_AGENT, target.constructor, existing)
  }
}
