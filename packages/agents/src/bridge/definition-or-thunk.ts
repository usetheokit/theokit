import type { ModelSelection } from '@theokit/sdk'

import {
  compileAgentDefinition,
  type AgentDefinition as TheokitAgentDefinition,
} from './define-agent.js'

/**
 * Only what the projection reads from `RuntimeOverrides`, declared structurally.
 *
 * `RuntimeOverrides` lives in `sdk-adapter.ts`, which imports THIS module — typing it by import would
 * close a cycle, and `module-graph.test.ts` fails on cycles by M69's decision. Three structural fields
 * cost less than relocating a public type.
 */

interface ProjectionOverrides {
  readonly model?: string | ModelSelection
  readonly reasoningEffort?: unknown
  readonly runContext?: unknown
}

/**
 * A definition, or a THUNK that produces one per session.
 *
 * M91 — the `apiKey` line just below has accepted a thunk since M74, added for **exactly** this
 * reason. The asymmetry was one line wide and cost a lot: with the object shape, trust, hooks, skills
 * and MCP are frozen at module load. In a `theokit acp` process an IDE keeps open for hours, that
 * reintroduces the staleness M67 removed by moving construction to the entry point.
 */
export type DefinitionOrThunk =
  | TheokitAgentDefinition
  | ((sessionId: string) => TheokitAgentDefinition | Promise<TheokitAgentDefinition>)

/** The projection the factory needs: compiled + resolved overrides. */
interface CompiledProjection {
  compiled: ReturnType<typeof compileAgentDefinition>
  model: string | ModelSelection
  reasoningEffort: ReturnType<typeof compileAgentDefinition>['reasoningEffort']
  runContext: ReturnType<typeof compileAgentDefinition>['runContext']
}

export function project(
  def: TheokitAgentDefinition,
  overrides: ProjectionOverrides,
): CompiledProjection {
  const compiled = compileAgentDefinition(def)
  return {
    compiled,
    model: overrides.model ?? compiled.model ?? 'openai/gpt-4o-mini',
    reasoningEffort:
      (overrides.reasoningEffort as CompiledProjection['reasoningEffort']) ??
      compiled.reasoningEffort,
    runContext: (overrides.runContext as CompiledProjection['runContext']) ?? compiled.runContext,
  }
}

/**
 * Decides ONCE which of the two shapes is in use and returns the right projector.
 *
 * The OBJECT shape compiles **outside** the closure and always returns the same projection —
 * byte-identical to the pre-M91 behaviour. Changing that would pass the per-session cost on to every
 * consumer that asked for nothing (ADR-1). The THUNK shape projects per session, which is what it buys.
 */
export function resolveProjection(
  def: DefinitionOrThunk,
  overrides: ProjectionOverrides,
): (sessionId: string) => Promise<CompiledProjection> {
  if (typeof def === 'function') {
    return async (sessionId) => project(await def(sessionId), overrides)
  }
  const eager = project(def, overrides)
  return () => Promise.resolve(eager)
}
