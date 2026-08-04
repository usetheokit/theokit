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
function* chunksDeErro(errorText: string, code: string | undefined): Generator<UIMessageChunk> {
  if (code !== undefined) {
    yield {
      type: DATA_PART_DO_CODE_DE_ERRO,
      data: { code },
      transient: true,
    } as unknown as UIMessageChunk
  }
  yield { type: 'error', errorText }
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
      if (event.type === 'checkpoint_saved') {
        yield* presenter.closeBlock()
        yield {
          type: 'data-checkpoint',
          data: {
            checkpointId: event.checkpointId,
            resumeToken: event.resumeToken,
            step: event.step,
          },
          transient: true,
        }
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
