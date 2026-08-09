/**
 * M82 T2.1 — `HookHandlers` é público e `.hooks()` o aceita.
 *
 * ## O que estes testes seguram
 *
 * `.hooks()` recebia `Readonly<Record<string, unknown>>`: qualquer chave passava e cada handler
 * chegava com `ctx: unknown`. Quem quisesse tipo declarava o seu — e o agent-builder declarou, com
 * um alias local de cinco handlers, quatro deles com `ctx: unknown` porque não havia contexto para
 * importar. É a mesma classe do M81 (`loadRole`): conhecimento do framework reimplementado no app.
 *
 * O teste de tipo aqui é uma asserção de COMPILAÇÃO — se `ctx` voltar a ser `unknown`, os acessos a
 * `ctx.name` / `ctx.toolCalls` param de compilar e o `tsc` do pacote falha. `vitest` transpila sem
 * typecheck, então este arquivo só prova o contrato quando o `tsc` roda junto (ele roda no
 * pre-push e no CI).
 */
import { describe, expect, it } from 'vitest'

import { AgentBuilder } from '../../src/index.js'
import type { HookHandlers } from '../../src/bridge/hook-handlers.js'

describe('M82 — public HookHandlers', () => {
  it('test_HookHandlers_types_the_ctx_of_every_handler', async () => {
    const names: string[] = []
    const handlers: HookHandlers = {
      // `ctx.name` só compila porque o contexto é `PreToolCallContext`, não `unknown`.
      pre_tool_call: (ctx) => {
        names.push(ctx.name)
        return undefined
      },
      // O ganho central do M82: o seam de transform enxerga as tool calls do turn.
      transform_tool_result: (results, ctx) => {
        for (const c of ctx.toolCalls) names.push(c.name)
        return results
      },
      post_tool_call: (ctx) => {
        names.push(ctx.result.stdout)
      },
    }

    const def = AgentBuilder.create().model('x').hooks(handlers).build()
    expect(def.hooks).toBe(handlers)

    // A coleção existe para ser LIDA: rodar os handlers prova que os campos tipados são chamáveis,
    // não só declaráveis. Sem esta parte o teste seria uma asserção de compilação disfarçada.
    await handlers.pre_tool_call?.({ agentId: 'a', runId: 'r', name: 'alpha', args: {} })
    await handlers.transform_tool_result?.([], {
      agentId: 'a',
      runId: 'r',
      toolCalls: [{ id: 'c1', name: 'beta', args: {} }],
    })
    expect(names).toEqual(['alpha', 'beta'])
  })

  it('test_COUNTERPROOF_hooks_still_accepts_the_loose_shape', () => {
    // ADR-4: estreitar de uma vez quebraria consumidor com handler não conforme. A união mantém o
    // caminho antigo vivo — sem esta contraprova, trocar a assinatura por `HookHandlers` puro
    // passaria no teste acima e quebraria quem hoje passa um mapa solto.
    const loose: Readonly<Record<string, unknown>> = { on_session_start: () => undefined }
    const def = AgentBuilder.create().model('x').hooks(loose).build()
    expect(def.hooks).toBe(loose)
  })
})
