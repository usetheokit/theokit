// M31 builder-only: the `@Agent/@Tool/@Toolbox/@HumanInTheLoop/@Guardrails/@Skills/@MainLoop/
// @SubAgents/@Checkpoint/@Mixin/…` decorators are removed from the public API (ADR-0043 D1/D2). The
// `AgentBuilder.create()` / `tool()` builders are the single authoring surface. The decorator implementations +
// their metadata getters remain internal (the compiler reads them via source-path imports).
// The decorator OPTION TYPES stay public (the framework + consumers annotate with them — e.g. the
// HITL `TimeoutAction` used by the approval-registry and the `AgentBuilder.create().approval(...)` options).
// M103 — the SDK value + types behind the narrowed `Agent` re-export at the bottom of the M58 block.
import { Agent as AgentDoSdk } from '@theokit/sdk'
import type { ListAgentsOptions, ListResult, SDKAgentInfo } from '@theokit/sdk'

export type { HumanInTheLoopOptions, TimeoutAction } from './types.js'
// M35 — the settled HITL decision type is part of the public approval contract: an `awaitApproval`
// resolver (the HTTP registry or the in-process seam) may return a bare boolean OR this structured value.
export type { HitlDecision } from './bridge/hitl-plugin.js'
// `ConfigurationError` is part of the public contract — consumers `catch` it. It used to reach the
// barrel via a compat re-export inside `capability/capabilities.ts` (removed in M56); export it here
// from its home module so removing that internal re-export does not drop it from the package API.
export { ConfigurationError } from './errors.js'
export * from './capability/index.js'
export * from './bridge/index.js'
export * from './loop/index.js'
export * from './guardrails/index.js'
export * from './a2a/agent-card.js'
export * from './a2a/mcp-server-manifest.js'
export * from './a2a/a2a-client.js'
export * from './conversation-scope.js'
export * from './skills-resolver.js'
export * from './acp/protocol.js'
export * from './acp/client.js'
export * from './manifest/agent-manifest.js'
export { agentsPlugin, type AgentsPluginOptions } from './theokit-plugin.js'
export type {
  AgentOptions,
  MainLoopOptions,
  MainLoopMeta,
  ToolboxOptions,
  ToolOptions,
  BudgetOptions,
  ApprovalOptions,
  PolicyHandler,
  ReasoningEffort,
  // M112 — a configuração de servidor MCP atravessa até a RAIZ. Sem isto, os nomes ficam em
  // `types.ts` e não alcançam `index.d.ts`: o consumidor volta a não conseguir nomear o tipo do
  // mapa que `loadMcpJson` devolve, que é metade do pedido P2 que este milestone atende.
  McpAuthConfig,
  McpHttpServerConfig,
  McpOAuthConfig,
  McpServerConfig,
  McpServersMap,
  McpStdioServerConfig,
} from './types.js'

// M58 — layered boundary `SDK → Theokit → AgentBuilder`: the consumer imports the SDK's already-OO
// core primitives from `@theokit/agents`, not from `@theokit/sdk` directly. PASS-THROUGH, never a
// wrapper (parsimony-ladder Rung 9): `Agent.create()` / `Tool.create()` / `Provider` are already the
// target OO shape, so wrapping them would be ceremony without value. The domains with their own
// infra surface (sandbox / persistence / interactive / pty) live on matching subpaths that mirror the
// SDK's own subpath split (`@theokit/agents/{sandbox,persistence,interactive,pty}`).
export { Squad, Tool, Provider } from '@theokit/sdk'
export type { SDKAgent, CustomTool, SessionRecord } from '@theokit/sdk'

// M103 (agent-builder) — `Agent` is the ONE exception to the pass-through doctrine above, and it is a
// narrowing of the TYPE only: the exported VALUE is the SDK's `Agent`, byte-identical.
//
// `ListAgentsOptions` promises `limit` and `cursor`; the runtime references NEITHER
// (`@theokit/sdk` `Agent.list` reads only `options.runtime`). A caller that passes `limit: 500`
// against a 688-entry registry believes it asked for a bounded page and silently receives the whole
// set — and the day the runtime starts honouring the parameter, the SAME code silently receives a
// TRUNCATED set instead. Both directions are silent, and one of them feeds a NEVER-delete guard in
// a garbage collector. The result type is narrowed for the same reason: `nextCursor` is never set,
// so a caller branching on it is branching on a value that cannot arrive.
//
// This is a `tipo fechado` control, not a lint: the call does not compile, so a new call site cannot
// be born wrong by omission. Residue (declared, not hidden): it binds TypeScript consumers only — a
// `.js` caller or an `as any` escapes.
//
// EXIT CRITERION: when the SDK runtime actually honours `limit`/`cursor`/`cwd` (tracked as the
// agent-builder's M107 upstream request), delete this block and restore `Agent` to the plain
// re-export on the line above.
type ListOptionsSemPaginacao = ListAgentsOptions & { limit?: never; cursor?: never }

type AgentComListaEstreitada = Omit<typeof AgentDoSdk, 'list'> & {
  list(options?: ListOptionsSemPaginacao): Promise<Omit<ListResult<SDKAgentInfo>, 'nextCursor'>>
}

export const Agent: AgentComListaEstreitada = AgentDoSdk

// M63 — closing the layered boundary so the consumer imports ZERO `@theokit/sdk*` directly. Same
// PASS-THROUGH doctrine as the M58 core above (Rung 9): these are already the target shape.
//  - `SubAgent` (a2a delegation primitive): `SubAgent.create()` is already OO; wrapping it adds nothing.
//  - the path-safety helpers are pure functions — a class would be ceremony (parsimony-ladder Rung 5).
export { SubAgent } from '@theokit/sdk/a2a'
export { assertNoSymlinkEscape, isForbiddenPath, safePathJoin } from '@theokit/sdk/path-safety'

// M77 — the context-window resolver, so a surface can render a budget meter against the REAL window
// instead of a constant. Same PASS-THROUGH doctrine (Rung 9): `resolveEffectiveContextWindow` is a
// pure function and `CONTEXT_WINDOW_*` are constants — wrapping them in a class would be ceremony.
//
// The consumer needs this because its TUI hardcoded `contextWindow: 400_000`, decoupled from the
// configured model: change the model and the meter silently lies. A meter that lies is worse than no
// meter, because it is trusted.
export {
  CONTEXT_WINDOW_FLOOR,
  CONTEXT_WINDOW_MARGIN,
  ContextWindowMarginError,
  resolveEffectiveContextWindow,
} from '@theokit/sdk/compaction'
export type { ContextWindowSource, EffectiveContextWindow } from '@theokit/sdk/compaction'

// M78 — a política de cobertura declarada. Antes deste milestone o barril crescia de forma REATIVA
// (símbolo a símbolo, sob pressão de bug) e cobria 9 dos 28 subpaths do SDK, sem nada avisar quando
// um subpath novo aparecia. `tests/unit/subpath-coverage.test.ts` agora exige veredito para TODOS os
// 28 — `in` (verificado) ou `out` (com razão escrita).
//
// Mesma doutrina de PASS-THROUGH do M58/M63 (Rung 9): estes já são a forma alvo — a hierarquia de
// erro é OO, `Retry`/`Semaphore` são classes, e as de `/messages` e `/models` são funções puras.
// Envolver qualquer uma seria cerimônia sem nada dentro.
//
// `/errors` é o eixo do milestone: o consumidor tem como regra INQUEBRÁVEL erro tipado, e sem acesso
// a esta hierarquia a única saída legal era criar uma PARALELA — foi o que aconteceu, cinco classes
// estendendo `Error` nu. E como `isTransientError` exige `TheokitAgentError`, o predicado que separa
// recuperável de irrecuperável era inútil lá por construção.
// `export *` e não uma lista curada, de propósito. A primeira versão re-exportava quatro classes
// escolhidas a dedo e `RateLimitError` — que o refresh OAuth precisa para reconhecer um 429 — ficou
// de fora sem nada acusar. Uma hierarquia de erro PELA METADE é exatamente o defeito que este
// milestone fecha: o consumidor voltaria a criar a classe que falta.
//
// O mesmo vale para os outros quatro: são subpaths pequenos e coesos, onde "parte do domínio" não é
// uma unidade que faça sentido. `tests/unit/subpath-coverage.test.ts` verifica a cobertura TOTAL
// destes, não uma amostra.
export * from '@theokit/sdk/errors'
export * from '@theokit/sdk/retry'
export * from '@theokit/sdk/concurrency'
export * from '@theokit/sdk/messages'
export * from '@theokit/sdk/models'
// M81 — o loader de subagents em disco. A assimetria oposta (skills com porta pública, subagents
// sem) é o que fez o consumidor escrever um SEGUNDO parser de `.md` — e depois um teste cuja única
// função era vigiar a divergência entre os dois. O que atravessa é a config PARSEADA, nunca o
// formato de arquivo: exportar o formato congelaria um detalhe interno como API pública.
export { discoverSubagents, loadSubagentDefinition } from '@theokit/sdk/subagents-loader'
// M96 U2 — o TIPO que o carregador acima devolve, publicado na linha vizinha (o par literal do peer,
// `gemini-cli/packages/core/src/index.ts:191-192`). O nome de origem está OCUPADO neste índice —
// `bridge/index.js` já exporta `AgentDefinition`, o tipo BRANDADO do builder —, então o consumidor
// que importasse o nome de origem receberia o tipo errado em silêncio, e a única saída restante era
// redeclarar a forma à mão. O alias resolve a colisão sem tocar no nome ocupado.
export type { AgentDefinition as SubagentDefinition } from '@theokit/sdk/subagents-loader'

// COLISÃO DE NOME RESOLVIDA no M91 — e a PRIMEIRA tentativa estava errada.
//
// `@theokit/sdk/errors` e `./bridge/index.js` exportavam ambos `BudgetExceededError`, e NÃO eram a
// mesma coisa: a do SDK é orçamento por JANELA (`budgetName`, `window`, `spentUsd`, `mode`); a da
// camada é orçamento por DELEGAÇÃO (`agentName`, `actualCost`, `budgetLimit`). Como o consumidor tem
// regra inquebrável de nunca importar `@theokit/sdk` direto, ele nunca alcançava a do SDK — e um
// `instanceof` casava com o domínio errado em silêncio.
//
// ## O que o `4.26.0` fez de errado, medido
//
// Ele **reaproveitou** o nome: o barril passou a exportar a classe do SDK sob `BudgetExceededError`.
// Para um consumidor em `^4.25` que fazia `catch (e) { if (e instanceof BudgetExceededError) … }`, o
// ramo de orçamento de delegação **deixou de casar, em silêncio** — exatamente o modo de falha que
// este milestone existe para matar, em espelho. E foi publicado como MINOR.
//
// ## A correção
//
// O nome antigo volta a ser a classe de DELEGAÇÃO — é o alias `@deprecated` que o DoD pediu, mesma
// identidade referencial de sempre, zero quebra para quem está em `^4.25`. A classe do SDK atravessa
// sob um nome que não colide, o que fecha a lacuna original sem reaproveitar nome de ninguém:
// "enriquecer nunca reduz" (M73) vale também para não redefinir o que um nome significa.
export { DelegationBudgetExceededError } from './bridge/delegation-types.js'
export {
  // O alias EXISTE para ser deprecado; re-exportá-lo é o contrato de compatibilidade, não descuido.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  BudgetExceededError,
} from './bridge/delegation-types.js'
export { BudgetExceededError as WindowBudgetExceededError } from '@theokit/sdk/errors'

// M82 — o tipo público dos handlers de `.hooks()`. Publicado porque a alternativa é o consumidor
// declarar o seu (foi o que o agent-builder fez, com `ctx: unknown` em quatro de cinco handlers).
export type { HookHandlers } from './bridge/hook-handlers.js'

// M84 — o transporte in-process veio do pacote CLI, onde era folha. Fica na barra principal (e não
// num subpath novo) porque "rodar um turn de agente" é exatamente o que a barra principal faz;
// separá-lo multiplicaria superfície sem separar nada. O CLI passa a re-exportar daqui.
export { streamAgentTurnInProcess, InProcessApprovalRequiredError } from './in-process-turn.js'
export type {
  StreamAgentTurnInProcessInput,
  StreamAgentTurnDeps,
  InProcessApprovalRequest,
  InProcessAwaitApproval,
} from './in-process-turn.js'
