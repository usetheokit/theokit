/**
 * M96 U1 (Fase 3) — a postura de aprovação vira parâmetro OBRIGATÓRIO de `toAgentFactory`.
 *
 * ## O defeito
 *
 * `toAgentFactory` compilava a definição — inclusive o mapa `compiled.hitl` que `.approvals({…})`
 * produz — e **descartava** o mapa. O descarte era admitido por escrito no próprio JSDoc
 * (*"Tools still execute; they are simply not HITL-gated here"*), enquanto o bridge irmão
 * (`streamAgentTurnInProcess`) RECUSA para a mesma definição. As superfícies sem humano usavam a
 * permissiva. Quatro tools executaram sem política consultada por três releases.
 *
 * O defeito é de TIPO, não de comportamento: a postura "sem HITL" não era representável como valor,
 * então era expressa como AUSÊNCIA — e ausência não tem `match` exaustivo, não aparece em log e não
 * reprova teste. As quatro variantes de `ApprovalPosture` tornam a permissiva um valor NOMEADO; o que
 * deixa de existir é a omissão.
 *
 * ## Por que o oráculo é o efeito colateral ausente (ADR D4)
 *
 * Um `rejects.toThrow` passa alegremente num sistema que devolve o erro DEPOIS de executar — que é a
 * forma exata deste defeito. O oráculo que pega é o do codex
 * (`codex-rs/core/tests/suite/approvals.rs:1499-1504`): `Expectation::FileNotCreated`, o **disco**, e
 * não a string do erro. Aqui: um arquivo sentinela que o handler da tool cria, mais um executor espião.
 *
 * ## Por que o despachante deste arquivo não é vacuidade
 *
 * Ele espelha o contrato de veto do SDK que `tests/integration/hitl-harness.test.ts` já documenta —
 * *"a `pre_tool_call` block makes the loop inject a denial tool result and CONTINUE"*. O que impede
 * que ele "prove" a não-execução por nunca executar nada é o par invertido:
 * `test_under_auto_approve_the_tool_runs_and_NO_request_is_emitted` roda o MESMO despachante e vê o
 * sentinela nascer. Um despachante quebrado reprova ali antes de mentir aqui.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApprovalPosture } from '../../src/bridge/approval-posture.js'

const captured = vi.hoisted(() => ({
  opcoes: undefined as Record<string, unknown> | undefined,
}))

vi.mock('@theokit/sdk', () => ({
  Agent: {
    getOrCreate: async (id: string, opts: Record<string, unknown>) => {
      captured.opcoes = opts
      return {
        agentId: id,
        send: async () => ({ wait: async () => ({}) }),
        dispose: async () => {},
      }
    },
  },
  Tool: { create: (spec: unknown) => spec },
}))

const { defineAgent } = await import('../../src/bridge/define-agent.js')
const { toAgentFactory } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentTurnInProcess, InProcessApprovalRequiredError } =
  await import('../../src/in-process-turn.js')

let dir: string
let sentinel: string
let executor: ReturnType<typeof vi.fn>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'm96-postura-'))
  sentinel = join(dir, 'a-tool-executou')
  executor = vi.fn(async () => {
    await writeFile(sentinel, 'executou')
    return 'ok'
  })
  captured.opcoes = undefined
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Uma definição com UMA tool gateada, cujo handler grava o sentinela no disco. */
function gatedDefinition() {
  return defineAgent({
    model: 'test',
    tools: [
      {
        name: 'run_shell',
        description: 'roda um comando',
        inputSchema: { type: 'object', properties: {} },
        handler: executor as never,
      },
    ],
    approvals: { run_shell: { question: 'Rodar run_shell?' } },
  })
}

function installedPluginNames(): string[] {
  const plugins = captured.opcoes?.plugins
  if (!Array.isArray(plugins)) return []
  return plugins.map((p) => String((p as { name?: unknown }).name))
}

type PreToolCallHandler = (ctx: {
  name: string
  args: Record<string, unknown>
  agentId: string
  runId: string
}) => unknown

/**
 * Espelha o despacho de tool do SDK: roda TODOS os `pre_tool_call` registrados e só então chama o
 * executor. Um veto (`{ block: true }`) impede o executor de ser alcançado — é literalmente o
 * contrato que `hitl-harness.test.ts` já reproduz.
 */
async function dispatchToolAsTheSdkWould(
  nome: string,
): Promise<{ bloqueada: boolean; message?: string }> {
  const handlers: PreToolCallHandler[] = []
  for (const plugin of (captured.opcoes?.plugins as readonly unknown[] | undefined) ?? []) {
    ;(
      plugin as { register: (ctx: { on: (h: string, fn: PreToolCallHandler) => void }) => void }
    ).register({
      on: (hook, fn) => {
        if (hook === 'pre_tool_call') handlers.push(fn)
      },
    })
  }
  for (const manipular of handlers) {
    const veto = (await manipular({ name: nome, args: {}, agentId: 'a', runId: 'r' })) as
      | { block?: boolean; message?: string }
      | undefined
    if (veto?.block === true) return { bloqueada: true, message: veto.message }
  }
  await executor()
  return { bloqueada: false }
}

async function materialize(posturePolicy: ApprovalPosture): Promise<void> {
  await toAgentFactory(gatedDefinition() as never, { apiKey: 'k', approvals: posturePolicy })('s1')
}

describe('M96 U1 — toAgentFactory requires the approval posture', () => {
  it('test_NEGATIVE_under_auto_reject_a_gated_tool_DOES_NOT_RUN', async () => {
    await materialize({ kind: 'auto-reject', reason: 'superfície não-atendida' })

    const outcome = await dispatchToolAsTheSdkWould('run_shell')

    expect(outcome.bloqueada, 'a tool gateada tem de ser vetada').toBe(true)
    // D4 — as DUAS metades do oráculo. A mensagem do erro sozinha passaria num sistema que devolve
    // o erro depois de executar, que é a forma exata do defeito que este milestone fecha.
    expect(
      existsSync(sentinel),
      'o efeito colateral ausente: o disco não pode ter sido tocado',
    ).toBe(false)
    expect(executor, 'o executor não pode ter sido alcançado').toHaveBeenCalledTimes(0)
    expect(outcome.message).toContain('superfície não-atendida')
  })

  it('test_under_auto_approve_the_tool_runs_and_NO_request_is_emitted', async () => {
    // O inverso do inverso, no molde de `wait_for_completion_without_approval` do codex: a postura
    // permissiva continua sendo uma POSTURA, e emitir pedido nela é defeito. É também o teste que
    // prova que o despachante acima EXECUTA quando ninguém bloqueia — sem ele, o caso negativo
    // seria indistinguível de um harness quebrado.
    await materialize({ kind: 'auto-approve', reason: 'sandbox confina a execução' })

    const outcome = await dispatchToolAsTheSdkWould('run_shell')

    expect(outcome.bloqueada).toBe(false)
    expect(existsSync(sentinel)).toBe(true)
    expect(executor).toHaveBeenCalledTimes(1)
    expect(installedPluginNames(), 'auto-approve não emite pedido nenhum').not.toContain(
      'theokit-hitl',
    )
  })

  it('test_under_interactive_the_approval_request_IS_EMITTED_before_execution', async () => {
    // A asserção INVERSA que D4 exige: reprovar quando o pedido NÃO é emitido. Sem ela, uma
    // implementação que instala o plugin e nunca o dispara ficaria verde em tudo acima.
    const order: string[] = []
    const emit = vi.fn((_evento: { type: string; toolName: string }) => {
      order.push('emit')
    })
    executor.mockImplementation(async () => {
      order.push('executor')
      await writeFile(sentinel, 'executou')
      return 'ok'
    })

    await materialize({
      kind: 'interactive',
      emit,
      awaitApproval: async () => true,
    })
    await dispatchToolAsTheSdkWould('run_shell')

    expect(emit, 'o pedido tem de ser emitido').toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      type: 'approval_required',
      toolName: 'run_shell',
    })
    expect(order, 'emitir DEPOIS de executar seria o mesmo defeito com outro nome').toEqual([
      'emit',
      'executor',
    ])
  })

  it('test_auto_reject_uses_the_hooks_plugin_and_does_NOT_require_emit', async () => {
    // A contraprova do mapeamento de D9. Sem ela, alguém "simplifica" exigindo `emit` nas quatro
    // variantes e três superfícies passam a carregar um seam que nenhuma delas usa.
    await materialize({ kind: 'auto-reject', reason: 'sonda nunca executa tool' })

    const names = installedPluginNames()
    expect(names).toContain('theokit-tool-hooks')
    expect(names).not.toContain('theokit-hitl')
  })

  it('test_owned_by_surface_does_not_install_the_plugin_and_carries_the_reason', async () => {
    // D3 — a variante NOMEIA o comportamento do ACP em vez de apagá-lo. Instalar o gate da camada
    // ali produziria DOIS pedidos para a mesma tool; apagar a distinção devolveria o bridge ao
    // estado de hoje. Nomear tem três consequências que a omissão não tem: aparece no `match`,
    // aparece em LOG (asserido aqui) e pode ser contada por um gate (no consumidor).
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const antes = process.env.THEOKIT_DEBUG
    process.env.THEOKIT_DEBUG = '1'
    try {
      await materialize({ kind: 'owned-by-surface', reason: 'ACP client owns the prompt' })
    } finally {
      if (antes === undefined) delete process.env.THEOKIT_DEBUG
      else process.env.THEOKIT_DEBUG = antes
    }

    expect(installedPluginNames()).toEqual([])
    const registered = debug.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(registered, 'a razão do bypass tem de ficar legível em runtime').toContain(
      'ACP client owns the prompt',
    )
    debug.mockRestore()
  })

  it('test_an_UNGATED_tool_passes_under_any_posture', async () => {
    // Caso de borda: `auto-reject` é a postura das tools GATEADAS, não um bloqueio universal.
    // Sem esta asserção, a variante mais segura quebraria todo agente que tem uma tool livre.
    await materialize({ kind: 'auto-reject', reason: 'sem humano' })

    const outcome = await dispatchToolAsTheSdkWould('read_file')

    expect(outcome.bloqueada).toBe(false)
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('test_an_abort_while_waiting_for_approval_DOES_NOT_RUN_the_tool', async () => {
    // A única seção deste milestone em que dois fluxos correm juntos: a espera do resolvedor e o
    // encerramento do turn. Um teste de cancelamento que só verifica a rejeição da promessa passaria
    // num sistema que executa a tool e aborta depois — daí o oráculo de D4 também aqui.
    //
    // LIMITE HONESTO: a propagação do `AbortSignal` é do SDK, não desta camada. O que este teste
    // fixa é a propriedade que É desta camada — enquanto a aprovação não resolve, a pausa SEGURA a
    // tool. O espião de `emit` prova que a pausa aconteceu de fato (e não que o caminho nunca foi
    // alcançado), que é a distinção que o seam de D9 torna escrevível.
    const emit = vi.fn()
    const control = new AbortController()
    await materialize({
      kind: 'interactive',
      emit,
      awaitApproval: () => new Promise(() => {}), // nunca resolve
    })

    const dispatch = dispatchToolAsTheSdkWould('run_shell')
    const corrida = await Promise.race([
      dispatch.then(() => 'despachou'),
      new Promise<string>((r) => {
        control.abort()
        setTimeout(() => r('abortou'), 20)
      }),
    ])

    expect(corrida, 'o despacho não pode completar enquanto a aprovação está pendente').toBe(
      'abortou',
    )
    expect(emit, 'a pausa tem de ter acontecido de fato').toHaveBeenCalledTimes(1)
    expect(existsSync(sentinel)).toBe(false)
    expect(executor).toHaveBeenCalledTimes(0)
  })

  it('test_the_toAgentFactory_JSDoc_no_longer_declares_the_discard', async () => {
    // No molde de `agents/m67-docs-truthfulness.test.ts`: uma prosa que descreve um comportamento
    // apagado é a classe de defeito que `adr-governance.md § 5` enumera. Aqui a prosa descrevia um
    // comportamento REAL, e é ela que documentava o buraco.
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(
      new URL('../../src/bridge/sdk-adapter.ts', import.meta.url),
      'utf8',
    )
    expect(source).not.toContain('not HITL-gated here')
  })
})

describe('M96 D2 — streamAgentTurnInProcess receives the posture ADDITIVELY', () => {
  it('test_streamAgentTurnInProcess_without_approvals_STILL_refuses', () => {
    // A contraprova do D2: o bridge in-process JÁ era fail-closed — é o lado correto da divergência
    // que o M96 existe para fechar. Um aditivo que afrouxasse o único bridge correto seria a
    // regressão mais cara deste plano.
    expect(() => streamAgentTurnInProcess(gatedDefinition(), 'k', { message: 'oi' })).toThrow(
      InProcessApprovalRequiredError,
    )
  })

  it('test_streamAgentTurnInProcess_under_auto_approve_runs_with_no_resolver', () => {
    // A metade que o aditivo entrega: a postura permissiva passa a ser EXPRIMÍVEL também ali, em vez
    // de inexprimível de um lado e nomeável do outro.
    expect(() =>
      streamAgentTurnInProcess(gatedDefinition(), 'k', {
        message: 'oi',
        approvals: { kind: 'auto-approve', reason: 'sandbox confina' },
      }),
    ).not.toThrow()
  })

  it('test_NEGATIVE_in_process_under_owned_by_surface_also_needs_no_resolver', () => {
    expect(() =>
      streamAgentTurnInProcess(gatedDefinition(), 'k', {
        message: 'oi',
        approvals: { kind: 'owned-by-surface', reason: 'a superfície pergunta' },
      }),
    ).not.toThrow()
  })
})

describe('M96 D1 — omission stops having a valid shape (a COMPILE-time gate)', () => {
  // Estes casos são executados por `pnpm typecheck` (o tsconfig da raiz inclui
  // `packages/*/tests/**/*.ts`): um `@ts-expect-error` que NÃO encontra erro é, ele próprio, um erro
  // de compilação. É o que converte a disciplina em gate em vez de convenção.
  it('test_NEGATIVE_omitting_approvals_fails_to_compile', () => {
    const callIt = () =>
      // @ts-expect-error — `approvals` é obrigatório: a omissão é o defeito que o M96 fecha.
      toAgentFactory(gatedDefinition() as never, { apiKey: 'k' })
    expect(callIt).toBeTypeOf('function')
  })

  it('test_NEGATIVE_interactive_without_emit_fails_to_compile', () => {
    // D9 — sem o seam, `interactive` não é instalável, e um default no-op devolveria o descarte
    // silencioso pela porta dos fundos.
    // @ts-expect-error — `emit` é obrigatório na variante que emite pedido.
    const posturePolicy: ApprovalPosture = { kind: 'interactive', awaitApproval: async () => true }
    expect(posturePolicy.kind).toBe('interactive')
  })

  it('test_NEGATIVE_owned_by_surface_without_a_reason_fails_to_compile', () => {
    // Um bypass sem justificativa escrita não deve ter forma válida.
    // @ts-expect-error — `reason` é obrigatório na variante de bypass.
    const posturePolicy: ApprovalPosture = { kind: 'owned-by-surface' }
    expect(posturePolicy.kind).toBe('owned-by-surface')
  })

  it('test_NEGATIVE_an_invented_variant_fails_to_compile', () => {
    // A união é FECHADA: o `match` exaustivo é o que faz a postura aparecer em log e em gate.
    // @ts-expect-error — `silent-discard` não é uma postura; era o estado de hoje, sem nome.
    const posturePolicy: ApprovalPosture = { kind: 'silent-discard', reason: 'x' }
    expect(posturePolicy).toBeDefined()
  })
})
