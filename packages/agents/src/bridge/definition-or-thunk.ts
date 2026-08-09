import type { ModelSelection } from '@theokit/sdk'

import {
  compileAgentDefinition,
  type AgentDefinition as TheokitAgentDefinition,
} from './define-agent.js'

/**
 * Só o que a projeção lê de `RuntimeOverrides`, declarado estruturalmente.
 *
 * `RuntimeOverrides` mora em `sdk-adapter.ts`, que importa ESTE módulo — tipá-lo por import fecharia um
 * ciclo, e `module-graph.test.ts` reprova ciclo por decisão do M69. Três campos estruturais custam menos
 * que mover um tipo público de lugar.
 */

export interface ProjectionOverrides {
  readonly model?: string | ModelSelection
  readonly reasoningEffort?: unknown
  readonly runContext?: unknown
}

/**
 * Uma definição, ou um THUNK que a produz por sessão.
 *
 * M91 — a linha do `apiKey` logo abaixo já aceitava thunk desde o M74, adicionada por **exatamente**
 * esta razão. A assimetria tinha uma linha de largura e custava caro: com a forma objeto, trust, hooks,
 * skills e MCP ficam congelados no load do módulo. Num processo `theokit acp` que uma IDE mantém aberto
 * por horas, isso reintroduz a obsolescência que o M67 removeu ao mover a construção para o entry point.
 */
export type DefinitionOrThunk =
  | TheokitAgentDefinition
  | ((sessionId: string) => TheokitAgentDefinition | Promise<TheokitAgentDefinition>)

/** A projeção que a fábrica precisa: compilada + overrides resolvidos. */
export interface CompiledProjection {
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
 * Decide UMA vez qual das duas formas está em uso e devolve o projetor certo.
 *
 * A forma OBJETO compila **fora** do closure e devolve sempre a mesma projeção — byte-idêntica ao
 * comportamento anterior ao M91. Mudar isso passaria o custo por sessão a cada consumidor que não pediu
 * nada (ADR-1). A forma THUNK projeta por sessão, que é o que ela compra.
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
