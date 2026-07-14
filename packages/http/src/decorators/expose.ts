import { setMeta, getMeta, EXPOSE_AGENT } from '../metadata/index.js'

/**
 * M47 (ADR-M47-1) — `@Expose(agent, opts?)` binds a SEPARATELY-BUILT agent (a pure `agent()…build()` from
 * `agents/<name>.ts`) to a controller PROPERTY, making the exposure (route, auth via `@UseGuards`, streaming)
 * visible in one code review. It mirrors the #122 verb decorators (`@Post`) — storing metadata via the same
 * `Symbol.for()` seam — but records the agent instead of an HTTP verb, so the controller walker turns the
 * property into an agent-serving route (`POST <prefix>/<property>`) delegated to the ONE runtime
 * (`mountAgent`), never a JSON handler. It is a new AUTHORING surface over the existing runtime, not a
 * parallel runtime (G2). CSRF is enforced once at the controller-dispatch boundary. Interceptors do NOT run
 * for agent routes (the dispatcher delegates straight to `mountAgent`); guards DO (G5). The served path is
 * the controller prefix + property name — keep it equal to the agent's convention route (`/api/agents/<name>`
 * for a property named `<name>` under `@Controller('api/agents')`) so the generated `useAgent(handle)` path
 * lines up.
 */

/**
 * Per-binding options for an exposed agent. Reserved for forward-compat — no options are wired yet.
 *
 * Two candidate fields were removed before shipping (M47 review): `path` (a route override) would let the
 * served URL diverge from the generated handle's path — the codegen derives the handle from the agent's
 * convention route (`/api/agents/<name>`), so an overridden route would make `useAgent(handle)` hit the
 * wrong URL. And `csrf` was a no-op — CSRF is enforced exactly once at the controller-dispatch boundary
 * regardless. Both return only when they can be wired end-to-end (codegen reads `@Expose` metadata / a
 * per-route CSRF opt-out threads through the dispatcher). Until then, `@Expose(agent)` is the shape, and the
 * exposure's path MUST be the convention route — put `@Expose` on a property named after the agent under
 * `@Controller('api/agents')` (e.g. `chat` for `agents/chat.ts` → `/api/agents/chat`).
 */
export type ExposeOptions = Record<string, never>

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
