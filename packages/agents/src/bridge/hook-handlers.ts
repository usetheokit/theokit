/**
 * M82 — the typed shape of `AgentBuilder.create().hooks({...})`.
 *
 * ## Por que este tipo mora aqui
 *
 * Até o M82 a assinatura era `Readonly<Record<string, unknown>>`: qualquer chave era aceita e cada
 * handler recebia `ctx: unknown`. O consumidor que quisesse tipo tinha de declarar o seu — e foi
 * exatamente o que o agent-builder fez, com um alias local de cinco handlers, quatro deles com
 * `ctx: unknown` porque não havia de onde importar os contextos.
 *
 * É a mesma classe que o M81 fechou com `discoverSubagents`: conhecimento do framework reimplementado
 * no app porque o framework não o publicava. O tipo nasce onde o conhecimento mora.
 *
 * ## Sobre `transform_tool_result`
 *
 * Este é o ÚNICO canal de estágio-de-tool cujo retorno o SDK aplica — `#runTransform` dobra o valor
 * devolvido; `#runFireAndForget`, usado por `post_tool_call`, descarta. Desde o M82 seu contexto
 * carrega `toolCalls`, de modo que uma política com escopo (por nome de tool) possa AGIR sobre o
 * resultado em vez de apenas observá-lo.
 */
import type {
  PostAssistantReplyContext,
  PostToolCallContext,
  PreToolCallContext,
  PreToolCallDecision,
  PreUserSendContext,
  PreUserSendResult,
  SessionLifecycleContext,
  ToolResultTransformContext,
  TransformContext,
} from '@theokit/sdk'

/**
 * Handlers de ciclo de vida chaveados por `HookName`.
 *
 * Cada campo é opcional: um agente registra só os eventos que lhe interessam. `.hooks()` aceita a
 * UNIÃO deste tipo com o shape solto de antes (ADR-4 do M82), então não é preciso index signature
 * implícita para o valor passar no call site — o estreitamento é gradual, não uma quebra.
 */
export interface HookHandlers {
  /**
   * Roda ANTES da tool. Devolver `{ block: true, message }` VETA a chamada — é o único hook com
   * poder de veto.
   */
  pre_tool_call?: (
    ctx: PreToolCallContext,
  ) => Promise<PreToolCallDecision | undefined> | PreToolCallDecision | undefined
  /**
   * Roda DEPOIS da tool, com `{name, args, result}`. Fire-and-forget: o retorno é **descartado**
   * pelo SDK. Para AGIR sobre o resultado use {@link transform_tool_result}.
   */
  post_tool_call?: (ctx: PostToolCallContext) => Promise<void> | void
  /**
   * Dobra os resultados de tool do turn antes de eles subirem ao modelo. Desde o M82 o contexto traz
   * `toolCalls` — plural, porque o seam recebe o LOTE do turn; correlacione por
   * `toolUseId === id`.
   */
  transform_tool_result?: <T>(results: T, ctx: ToolResultTransformContext) => Promise<T> | T
  /** Dobra o texto do modelo antes de ele ser consumido. Sem tool call envolvida. */
  transform_llm_output?: (output: string, ctx: TransformContext) => Promise<string> | string
  on_session_start?: (ctx: SessionLifecycleContext) => Promise<void> | void
  on_session_end?: (ctx: SessionLifecycleContext) => Promise<void> | void
  pre_user_send?: (
    ctx: PreUserSendContext,
  ) => Promise<PreUserSendResult | undefined> | PreUserSendResult | undefined
  post_assistant_reply?: (ctx: PostAssistantReplyContext) => Promise<void> | void
}
