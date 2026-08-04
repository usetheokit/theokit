import { UIMessageStreamPresenter } from '@theokit/presenter'
import type { AgentOutputEvent } from '@theokit/presenter'
import type { UIMessageChunk } from 'ai'

import type { AgentStreamEvent, AgentTurnMetadata, DoneEvent } from './agent-stream-events.js'

/**
 * M49 — the web surface, composed over `@theokit/presenter`. Replaces the inline `translateToUIMessageStream`.
 *
 * The PURE-OUTPUT variants of `AgentStreamEvent` map to the canonical `AgentOutputEvent` and are rendered
 * by the shared {@link UIMessageStreamPresenter} (the single source of the UIMessageChunk state machine,
 * reused by every surface). The FRAMEWORK variants that only the web/devtools path has — HITL
 * `approval_required`, `checkpoint_saved` — are composed INLINE here (ADR-4: they are not pure agent
 * output, so they never entered the presenter's canonical event). Behavior is byte-identical to the
 * original translator (proven by `present-ui-message-stream.test.ts`).
 */

/** Map a pure-output `AgentStreamEvent` to the canonical event, or `null` for framework/no-output variants. */
function toAgentOutputEvent(e: AgentStreamEvent): AgentOutputEvent | null {
  switch (e.type) {
    case 'text_delta':
      return { type: 'text', text: e.content }
    case 'thinking':
      return { type: 'reasoning', text: e.content }
    case 'tool_call':
      return { type: 'tool-call', callId: e.callId, name: e.toolName, input: e.input }
    case 'tool_result':
      return {
        type: 'tool-result',
        callId: e.callId,
        name: e.toolName,
        result: e.output,
        isError: e.isError,
      }
    default:
      return null
  }
}

/** Project the `done` event's authoritative totals into the finish chunk's metadata (unchanged from M1). */
function doneToMetadata(event: DoneEvent): AgentTurnMetadata {
  return event.cost === undefined
    ? { usage: event.usage, durationMs: event.durationMs }
    : { usage: event.usage, durationMs: event.durationMs, cost: event.cost }
}

/** O nome do data part que carrega o `code`. Público de fato: o consumidor casa por ele. */
export const DATA_PART_DO_CODE_DE_ERRO = 'data-error-code'

/**
 * Data-part names for the three signals theokit#141 restored. Public in effect — a consumer matches
 * on the literal — so they are exported and asserted from the constant, never re-typed at call sites.
 */
export const DATA_PART_DO_INPUT_REQUESTED = 'data-input-requested'
export const DATA_PART_DO_TASK_PROGRESS = 'data-task-progress'
export const DATA_PART_DO_SHELL_OUTPUT = 'data-shell-output'

/**
 * O erro, em chunks que o protocolo aceita — theokit#161 (B).
 *
 * ## O defeito medido
 *
 * O M95 pôs o `code` DENTRO do chunk de erro (`{type:'error', errorText, errorCode}`), e a razão era
 * boa: sem ele, um consumidor que precise **distinguir** a falha só tem a mensagem, e casar texto de
 * erro é a heurística que este ecossistema já pagou caro — o M93 classificava transitório por regex
 * sobre a mensagem e tratava `ECONNREFUSED …:443` como definitivo porque a **porta** casava o padrão
 * de "4xx".
 *
 * Só que a variante `error` do `uiMessageChunkSchema` do `ai` é **estrita**: qualquer chave a mais a
 * invalida. Medido contra `ai@7.0.14` — `{type:'error',errorText:'boom'}` valida; o mesmo chunk com
 * `errorCode` **não**. Ou seja, desde o M95 este caminho emitia um chunk fora do protocolo que ele
 * afirma falar, e um consumidor que valide o rejeitaria inteiro — perdendo também o texto.
 *
 * Ninguém viu porque o teste que existia para pegar isso parava **antes** de validar: a asserção de
 * pré-condição (`toContainEqual({type:'error',errorText:'boom'})`) ficou desatualizada quando o
 * `errorCode` apareceu, e o laço de validação nunca chegou a rodar.
 *
 * ## Por que data part, e não uma das saídas fáceis
 *
 * Dropar o `errorCode` devolveria o consumidor ao casamento de texto que o M95 removeu. Embutir o
 * code no `errorText` é a mesma coisa com outro nome. O protocolo já tem o lugar certo — um data
 * part —, e este arquivo já o usa para `data-checkpoint`. Medido: valida.
 *
 * `transient: true` porque um code de erro é diagnóstico do turno, não conteúdo de mensagem: o SDK
 * não o persiste no histórico, que é exatamente o que se quer.
 *
 * O data part vem **antes** do chunk de erro de propósito: quem consome sequencialmente já tem o
 * code na mão quando o erro chega. Na ordem inversa, o consumidor teria de tratar o erro para só
 * depois descobrir qual era.
 */
/**
 * A transient data part. Centralised because the cast is the interesting bit: `UIMessageChunk`'s
 * data variant is keyed on `data-${string}`, which a `const` name does not narrow to on its own.
 * One place to hold the cast beats one per call site.
 */
function dataPart(type: string, data: Record<string, unknown>): UIMessageChunk {
  return { type, data, transient: true } as unknown as UIMessageChunk
}

function* chunksDeErro(errorText: string, code: string | undefined): Generator<UIMessageChunk> {
  if (code !== undefined) yield dataPart(DATA_PART_DO_CODE_DE_ERRO, { code })
  yield { type: 'error', errorText }
}

/**
 * The turn-diagnostic events, as the single data part each becomes — or `null` when the event is
 * not one of them.
 *
 * These are framework variants, so they never entered the presenter's canonical `AgentOutputEvent`
 * (ADR-4). They share one shape — close the open block, emit one transient data part — so they
 * share one function: written as four inline branches in the dispatch loop they pushed
 * `presentUIMessageStream` past both the cyclomatic and cognitive complexity ceilings, and the
 * repetition of `closeBlock()` at each branch was an invitation to forget it at the fifth.
 *
 * `checkpoint_saved` joins them because it always was one of these; only its name predates the
 * pattern. `approval_required` stays inline: it emits TWO chunks and consults presenter state, so
 * it is genuinely a different shape rather than the same one spelled differently.
 */
function dataPartDeDiagnostico(event: AgentStreamEvent): UIMessageChunk | null {
  switch (event.type) {
    case 'checkpoint_saved':
      return dataPart('data-checkpoint', {
        checkpointId: event.checkpointId,
        resumeToken: event.resumeToken,
        step: event.step,
      })
    // theokit#141 — without these cases the three restored events would be dropped by the loop's
    // catch-all, which is the reported defect one layer down: translating an event and never
    // presenting it leaves the consumer just as blind, minus even the warning.
    case 'input_requested':
      return dataPart(DATA_PART_DO_INPUT_REQUESTED, { requestId: event.requestId })
    case 'task_progress':
      return dataPart(DATA_PART_DO_TASK_PROGRESS, {
        ...(event.status !== undefined ? { status: event.status } : {}),
        ...(event.text !== undefined ? { text: event.text } : {}),
      })
    case 'shell_output':
      return dataPart(DATA_PART_DO_SHELL_OUTPUT, { event: event.event })
    default:
      return null
  }
}

export async function* presentUIMessageStream(
  events: AsyncIterable<AgentStreamEvent>,
  opts: { textId: string },
): AsyncGenerator<UIMessageChunk, void, unknown> {
  const presenter = new UIMessageStreamPresenter({ textId: opts.textId })
  yield { type: 'start' }
  let turnMetadata: AgentTurnMetadata | undefined
  try {
    for await (const event of events) {
      const output = toAgentOutputEvent(event)
      if (output !== null) {
        yield* presenter.present(output)
        continue
      }
      if (event.type === 'approval_required') {
        // A framework chunk must not sit inside an open text/reasoning block — close it first (as the
        // original translator did), then synthesize the tool-input (EC-1) once, then the approval.
        yield* presenter.closeBlock()
        if (!presenter.hasSeen(event.callId)) {
          presenter.markSeen(event.callId)
          yield {
            type: 'tool-input-available',
            toolCallId: event.callId,
            toolName: event.toolName,
            input: event.input ?? {},
            dynamic: true,
          }
        }
        yield { type: 'tool-approval-request', approvalId: event.callId, toolCallId: event.callId }
        continue
      }
      const diagnostico = dataPartDeDiagnostico(event)
      if (diagnostico !== null) {
        yield* presenter.closeBlock()
        yield diagnostico
        continue
      }
      if (event.type === 'error') {
        yield* chunksDeErro(event.message, (event as { code?: string }).code)
        break
      }
      if (event.type === 'done') {
        turnMetadata = doneToMetadata(event)
        break
      }
      // run_started, iteration, partial_tool_call, artifact_*, state_update, file_edit → no web chunk.
    }
  } catch (err) {
    const code = (err as { code?: string }).code
    yield* chunksDeErro(String(err), typeof code === 'string' ? code : undefined)
  }
  yield* presenter.finish(turnMetadata)
}
