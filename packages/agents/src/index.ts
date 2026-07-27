// M31 builder-only: the `@Agent/@Tool/@Toolbox/@HumanInTheLoop/@Guardrails/@Skills/@MainLoop/
// @SubAgents/@Checkpoint/@Mixin/…` decorators are removed from the public API (ADR-0043 D1/D2). The
// `AgentBuilder.create()` / `tool()` builders are the single authoring surface. The decorator implementations +
// their metadata getters remain internal (the compiler reads them via source-path imports).
// The decorator OPTION TYPES stay public (the framework + consumers annotate with them — e.g. the
// HITL `TimeoutAction` used by the approval-registry and the `AgentBuilder.create().approval(...)` options).
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
} from './types.js'

// M58 — layered boundary `SDK → Theokit → AgentBuilder`: the consumer imports the SDK's already-OO
// core primitives from `@theokit/agents`, not from `@theokit/sdk` directly. PASS-THROUGH, never a
// wrapper (parsimony-ladder Rung 9): `Agent.create()` / `Tool.create()` / `Provider` are already the
// target OO shape, so wrapping them would be ceremony without value. The domains with their own
// infra surface (sandbox / persistence / interactive / pty) live on matching subpaths that mirror the
// SDK's own subpath split (`@theokit/agents/{sandbox,persistence,interactive,pty}`).
export { Agent, Squad, Tool, Provider } from '@theokit/sdk'
export type { SDKAgent, CustomTool, SessionRecord } from '@theokit/sdk'

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

// COLISÃO DE NOME RESOLVIDA no M91 — era declarada e agora está paga.
//
// `@theokit/sdk/errors` e `./bridge/index.js` exportavam ambos `BudgetExceededError`, e NÃO eram a
// mesma coisa: a do SDK é orçamento por JANELA (`budgetName`, `window`, `spentUsd`, `mode`); a da
// camada é orçamento por DELEGAÇÃO (`agentName`, `actualCost`, `budgetLimit`).
//
// Como o consumidor tem regra inquebrável de nunca importar `@theokit/sdk` direto, ele **nunca
// alcançava a do SDK** pelo barril — e um `instanceof` casava com o domínio errado em silêncio. O
// comentário anterior registrava isso como lacuna conhecida e dizia que renomear era breaking, fora
// do escopo do M78. O M91 renomeou, com alias `@deprecated` por uma major.
//
// Agora as duas atravessam: `DelegationBudgetExceededError` daqui, `BudgetExceededError` do SDK.
export {
  DelegationBudgetExceededError,
  /** @deprecated Use `DelegationBudgetExceededError` — mesma classe, alias por uma major. */
  BudgetExceededError as DelegationBudgetExceededErrorAlias,
} from './bridge/delegation-types.js'
export { BudgetExceededError } from '@theokit/sdk/errors'

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
