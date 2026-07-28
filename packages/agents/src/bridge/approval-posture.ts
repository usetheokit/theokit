/**
 * M96 U1 — a postura de aprovação: o que uma superfície faz quando uma tool gateada pede aprovação.
 *
 * ## Por que um tipo fechado, e por que obrigatório
 *
 * O defeito que este módulo fecha era de TIPO, não de comportamento. A postura "sem HITL" não era
 * representável como valor, então era expressa como AUSÊNCIA — e uma ausência não tem `match`
 * exaustivo, não aparece em log e não reprova teste. `toAgentFactory` compilava o mapa
 * `compiled.hitl` que `.approvals({…})` produz e o descartava, com o descarte admitido por escrito no
 * JSDoc, enquanto o bridge irmão RECUSAVA para a mesma definição.
 *
 * A postura permissiva continua inteiramente expressável — como VALOR NOMEADO, com razão escrita. O
 * que deixa de existir é a omissão.
 *
 * ## Os peers
 *
 * `codex` modela a postura como `enum AskForApproval` de quatro variantes no crate de protocolo, e
 * torna o esquecimento um erro de compilação pela supertrait `ToolRuntime: Approvable + Sandboxable`;
 * o campo obrigatório é o mais perto disso que o sistema de tipos daqui chega. `codex` também resolve
 * a ambiguidade da omissão na direção segura (`GranularApprovalConfig`: campo ausente é
 * auto-REJEITADO, nunca auto-aprovado), e nomeia o substituto do humano em vez de deduzi-lo da
 * ausência de um (`ApprovalReviewer::{Guardian, User}`). `opencode` faz o mesmo pelo avesso: ausência
 * de regra resolve para `ask`.
 */
import { debugLog } from '../debug-log.js'
import type { HumanInTheLoopOptions } from '../types.js'

import type { ApprovalRequiredEvent } from './agent-stream-events.js'
import { createHitlPlugin, type HitlDecision } from './hitl-plugin.js'
import { createToolHooksPlugin } from './tool-hooks-plugin.js'

/** O mapa de tools gateadas que `compileAgentDefinition` produz (`compiled.hitl`). */
export type GatedTools = ReadonlyMap<string, HumanInTheLoopOptions>

/**
 * O que esta superfície faz quando uma tool gateada pede aprovação. Quatro variantes, nenhuma delas
 * "omissão" — cada uma com um consumidor concreto e uma razão escrita.
 */
export type ApprovalPosture =
  | {
      /** Há humano: o pedido é EMITIDO e a execução pausa até a decisão chegar. */
      kind: 'interactive'
      /**
       * Empurra o `ApprovalRequiredEvent` para o stream da superfície. OBRIGATÓRIO: `toAgentFactory`
       * devolve um handle cru, sem stream nem translator, então o sink vem de quem passa a postura —
       * que é justamente a superfície dona do stream. Um default no-op devolveria o descarte
       * silencioso pela porta dos fundos: o pedido seria "emitido" para lugar nenhum.
       */
      emit: (event: ApprovalRequiredEvent) => void
      /** Resolve a decisão humana; a execução fica pausada até isto resolver. */
      awaitApproval: (
        approvalId: string,
        opts: HumanInTheLoopOptions,
        toolName: string,
      ) => Promise<boolean | HitlDecision>
    }
  | {
      /** Ninguém pergunta e a tool roda. Legítimo quando outra coisa confina a execução. */
      kind: 'auto-approve'
      reason: string
    }
  | {
      /** Ninguém pergunta e a tool NÃO roda — a leitura segura da omissão (codex `GranularApprovalConfig`). */
      kind: 'auto-reject'
      reason: string
    }
  | {
      /**
       * O gate é conduzido pela SUPERFÍCIE servidora (o cliente ACP, pelo próprio protocolo), então
       * a camada não instala plugin nenhum. É um bypass — mas um bypass NOMEADO, com razão escrita,
       * que aparece no `match`, aparece em log e pode ser contado por um gate. O que ele substitui é
       * pior: hoje o mesmo efeito acontece por omissão, sem nada disso.
       */
      kind: 'owned-by-surface'
      reason: string
    }

/** A razão declarada, para as variantes que carregam uma (log e diagnóstico). */
function razaoDe(postura: ApprovalPosture): string {
  return postura.kind === 'interactive' ? 'human approver on this surface' : postura.reason
}

/**
 * Escreve os plugins que a postura exige dentro de `extra` — o objeto que `toAgentFactory` espalha
 * DEPOIS de `m8` nas opções de `Agent.create`, e que portanto vence. Os plugins já presentes (do
 * agente, via `m8`, e de um override, via `extra`) são preservados: atropelá-los é a regressão do
 * M14 contra a qual `buildExtraCreateOptions` já carrega uma guarda.
 *
 * A forma legada de `plugins` (objeto `{ enabled }`) não consegue carregar os dois, então uma postura
 * que precise instalar plugin ao lado dela é recusada em ALTO E BOM SOM, em vez de resolvida
 * descartando um deles: descartar o gate de aprovação em silêncio é exatamente a classe de defeito
 * que este milestone fecha (Rule 8, fail-closed).
 */
export function aplicarPostura(
  extra: Record<string, unknown>,
  // Só o campo lido é declarado: `M8CreateOptions` não tem index signature, e exigir uma aqui
  // acoplaria esta função à forma inteira das opções por um campo só.
  m8: { plugins?: unknown },
  postura: ApprovalPosture,
  gated: GatedTools | undefined,
): void {
  const daPostura = pluginsDaPostura(postura, gated)
  if (daPostura.length === 0) return
  const atuais = extra.plugins ?? m8.plugins
  if (atuais !== undefined && !Array.isArray(atuais)) {
    throw new Error(
      `[@theokit/agents] approval posture "${postura.kind}" needs to install a plugin, but ` +
        `\`plugins\` was supplied in the legacy object form, which cannot carry both. Pass ` +
        `\`plugins\` as an array so the approval gate is not dropped.`,
    )
  }
  extra.plugins = [...((atuais as readonly unknown[] | undefined) ?? []), ...daPostura]
}

/**
 * Os plugins que a postura exige. Cada variante escolhe o plugin que a satisfaz — nenhum é
 * inventado aqui: `createHitlPlugin` e `createToolHooksPlugin` já existiam e já eram a forma de
 * pausar e de vetar. O que faltava era serem alcançados por este caminho.
 *
 * Sem tool gateada não há plugin a instalar em variante nenhuma: a postura descreve o que fazer com
 * um gate, e um agente sem gate não tem o que decidir.
 */
function pluginsDaPostura(
  postura: ApprovalPosture,
  gated: GatedTools | undefined,
): readonly unknown[] {
  debugLog('[theokit] approval posture', { kind: postura.kind, reason: razaoDe(postura) })
  if (gated === undefined || gated.size === 0) return []

  switch (postura.kind) {
    case 'interactive':
      return [
        createHitlPlugin({
          gated: gated as Map<string, HumanInTheLoopOptions>,
          emit: postura.emit,
          awaitApproval: postura.awaitApproval,
        }),
      ]
    case 'auto-approve':
      // Um hook que sempre permite é observável, e é essa a diferença entre a permissiva NOMEADA e o
      // descarte de hoje: cada tool gateada que roda sem humano deixa rastro em runtime.
      return [
        createToolHooksPlugin({
          beforeToolCall: (ctx) => {
            if (gated.has(ctx.name)) {
              debugLog('[theokit] gated tool auto-approved', {
                tool: ctx.name,
                reason: postura.reason,
              })
            }
            return undefined
          },
        }),
      ]
    case 'auto-reject':
      return [
        createToolHooksPlugin({
          // Só as tools GATEADAS são recusadas: a postura descreve o gate, não um bloqueio universal.
          // Recusar tudo quebraria todo agente que tem uma tool livre ao lado de uma gateada.
          beforeToolCall: (ctx) =>
            gated.has(ctx.name)
              ? {
                  block: true,
                  message:
                    `Tool '${ctx.name}' requires human approval, and this surface has no approver ` +
                    `(approval posture: auto-reject — ${postura.reason}). Refused (fail-closed).`,
                }
              : undefined,
        }),
      ]
    case 'owned-by-surface':
      // A superfície servidora já pergunta pelo protocolo. Instalar o gate da camada aqui produziria
      // DOIS pedidos para a mesma tool — regressão de usabilidade vestida de segurança.
      return []
  }
}
