import type { CustomTool } from '@theokit/sdk'

import type { CompiledTool } from './agent-compiler.js'

/**
 * Normalize a pre-built `@theokit/sdk` {@link CustomTool} to the internal
 * {@link CompiledTool} shape (issue #81). `CustomTool.handler` takes a narrower
 * `Record<string, unknown>` input than `CompiledTool.handler`'s `unknown`, so it cannot be
 * assigned directly (contravariance); this thin wrapper bridges the parameter. Runtime-safe:
 * the SDK always calls a tool handler with the parsed input object.
 */
export function toCompiledTool(tool: CustomTool): CompiledTool {
  // M7 — forward the run-context `ctx` (2nd arg) to the underlying tool so `defineAgent({ context })`
  // reaches `ctx.context` in the handler (dropping it silently severs the context seam).
  // `CustomTool.handler` takes `Record<string, unknown>` as input; `CompiledTool.handler` takes the
  // wider `unknown`. Contravariance on the input parameter prevents direct assignment — `as unknown as`
  // is the SDK-boundary seam for this widening. Runtime-safe: SDK always passes a plain object for input.
  // Call `handler` as a METHOD of `tool` so a handler that reads `this` keeps its receiver.
  const owner = tool as unknown as {
    handler: (
      input: unknown,
      ctx?: { signal?: AbortSignal; context?: unknown },
    ) => string | Promise<string>
  }
  // Spread copies every own enumerable property, string- and symbol-keyed alike — notably the
  // `@theokit/sdk/a2a` subagent credential-inheritance sink (`Symbol.for("theokit.subagent.inheritCredentials")`),
  // without which the SDK runtime can't hand the parent's `apiKey` down to a delegated child
  // (`provider_unresolved`). The wrapped handler still calls the original tool's handler, so the sink
  // (which mutates that handler's closure) stays effective.
  const compiled: CompiledTool = {
    ...(tool as unknown as CompiledTool),
    handler: (input, ctx) => owner.handler(input, ctx),
  }
  return compiled
}
