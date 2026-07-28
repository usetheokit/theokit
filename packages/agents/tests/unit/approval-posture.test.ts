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
 * `test_sob_auto_approve_a_tool_executa_e_NENHUM_pedido_e_emitido` roda o MESMO despachante e vê o
 * sentinela nascer. Um despachante quebrado reprova ali antes de mentir aqui.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApprovalPosture } from '../../src/bridge/approval-posture.js'

const capturado = vi.hoisted(() => ({
  opcoes: undefined as Record<string, unknown> | undefined,
}))

vi.mock('@theokit/sdk', () => ({
  Agent: {
    getOrCreate: async (id: string, opts: Record<string, unknown>) => {
      capturado.opcoes = opts
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
let sentinela: string
let executor: ReturnType<typeof vi.fn>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'm96-postura-'))
  sentinela = join(dir, 'a-tool-executou')
  executor = vi.fn(async () => {
    await writeFile(sentinela, 'executou')
    return 'ok'
  })
  capturado.opcoes = undefined
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Uma definição com UMA tool gateada, cujo handler grava o sentinela no disco. */
function definicaoGateada() {
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

function nomesDosPluginsInstalados(): string[] {
  const plugins = capturado.opcoes?.plugins
  if (!Array.isArray(plugins)) return []
  return plugins.map((p) => String((p as { name?: unknown }).name))
}

type ManipuladorPreToolCall = (ctx: {
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
async function despacharToolComoOSdkFaria(
  nome: string,
): Promise<{ bloqueada: boolean; message?: string }> {
  const manipuladores: ManipuladorPreToolCall[] = []
  for (const plugin of (capturado.opcoes?.plugins as readonly unknown[] | undefined) ?? []) {
    ;(
      plugin as { register: (ctx: { on: (h: string, fn: ManipuladorPreToolCall) => void }) => void }
    ).register({
      on: (hook, fn) => {
        if (hook === 'pre_tool_call') manipuladores.push(fn)
      },
    })
  }
  for (const manipular of manipuladores) {
    const veto = (await manipular({ name: nome, args: {}, agentId: 'a', runId: 'r' })) as
      | { block?: boolean; message?: string }
      | undefined
    if (veto?.block === true) return { bloqueada: true, message: veto.message }
  }
  await executor()
  return { bloqueada: false }
}

async function materializar(postura: ApprovalPosture): Promise<void> {
  await toAgentFactory(definicaoGateada() as never, { apiKey: 'k', approvals: postura })('s1')
}

describe('M96 U1 — toAgentFactory exige a postura de aprovação', () => {
  it('test_NEGATIVO_sob_auto_reject_uma_tool_gateada_NAO_EXECUTA', async () => {
    await materializar({ kind: 'auto-reject', reason: 'superfície não-atendida' })

    const resultado = await despacharToolComoOSdkFaria('run_shell')

    expect(resultado.bloqueada, 'a tool gateada tem de ser vetada').toBe(true)
    // D4 — as DUAS metades do oráculo. A mensagem do erro sozinha passaria num sistema que devolve
    // o erro depois de executar, que é a forma exata do defeito que este milestone fecha.
    expect(
      existsSync(sentinela),
      'o efeito colateral ausente: o disco não pode ter sido tocado',
    ).toBe(false)
    expect(executor, 'o executor não pode ter sido alcançado').toHaveBeenCalledTimes(0)
    expect(resultado.message).toContain('superfície não-atendida')
  })

  it('test_sob_auto_approve_a_tool_executa_e_NENHUM_pedido_e_emitido', async () => {
    // O inverso do inverso, no molde de `wait_for_completion_without_approval` do codex: a postura
    // permissiva continua sendo uma POSTURA, e emitir pedido nela é defeito. É também o teste que
    // prova que o despachante acima EXECUTA quando ninguém bloqueia — sem ele, o caso negativo
    // seria indistinguível de um harness quebrado.
    await materializar({ kind: 'auto-approve', reason: 'sandbox confina a execução' })

    const resultado = await despacharToolComoOSdkFaria('run_shell')

    expect(resultado.bloqueada).toBe(false)
    expect(existsSync(sentinela)).toBe(true)
    expect(executor).toHaveBeenCalledTimes(1)
    expect(nomesDosPluginsInstalados(), 'auto-approve não emite pedido nenhum').not.toContain(
      'theokit-hitl',
    )
  })

  it('test_sob_interactive_o_pedido_de_aprovacao_E_EMITIDO_antes_da_execucao', async () => {
    // A asserção INVERSA que D4 exige: reprovar quando o pedido NÃO é emitido. Sem ela, uma
    // implementação que instala o plugin e nunca o dispara ficaria verde em tudo acima.
    const ordem: string[] = []
    const emit = vi.fn((_evento: { type: string; toolName: string }) => {
      ordem.push('emit')
    })
    executor.mockImplementation(async () => {
      ordem.push('executor')
      await writeFile(sentinela, 'executou')
      return 'ok'
    })

    await materializar({
      kind: 'interactive',
      emit,
      awaitApproval: async () => true,
    })
    await despacharToolComoOSdkFaria('run_shell')

    expect(emit, 'o pedido tem de ser emitido').toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      type: 'approval_required',
      toolName: 'run_shell',
    })
    expect(ordem, 'emitir DEPOIS de executar seria o mesmo defeito com outro nome').toEqual([
      'emit',
      'executor',
    ])
  })

  it('test_auto_reject_usa_o_plugin_de_hooks_e_NAO_exige_emit', async () => {
    // A contraprova do mapeamento de D9. Sem ela, alguém "simplifica" exigindo `emit` nas quatro
    // variantes e três superfícies passam a carregar um seam que nenhuma delas usa.
    await materializar({ kind: 'auto-reject', reason: 'sonda nunca executa tool' })

    const nomes = nomesDosPluginsInstalados()
    expect(nomes).toContain('theokit-tool-hooks')
    expect(nomes).not.toContain('theokit-hitl')
  })

  it('test_owned_by_surface_nao_instala_o_plugin_e_carrega_a_razao', async () => {
    // D3 — a variante NOMEIA o comportamento do ACP em vez de apagá-lo. Instalar o gate da camada
    // ali produziria DOIS pedidos para a mesma tool; apagar a distinção devolveria o bridge ao
    // estado de hoje. Nomear tem três consequências que a omissão não tem: aparece no `match`,
    // aparece em LOG (asserido aqui) e pode ser contada por um gate (no consumidor).
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const antes = process.env.THEOKIT_DEBUG
    process.env.THEOKIT_DEBUG = '1'
    try {
      await materializar({ kind: 'owned-by-surface', reason: 'ACP client owns the prompt' })
    } finally {
      if (antes === undefined) delete process.env.THEOKIT_DEBUG
      else process.env.THEOKIT_DEBUG = antes
    }

    expect(nomesDosPluginsInstalados()).toEqual([])
    const registrado = debug.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(registrado, 'a razão do bypass tem de ficar legível em runtime').toContain(
      'ACP client owns the prompt',
    )
    debug.mockRestore()
  })

  it('test_uma_tool_NAO_gateada_passa_sob_qualquer_postura', async () => {
    // Caso de borda: `auto-reject` é a postura das tools GATEADAS, não um bloqueio universal.
    // Sem esta asserção, a variante mais segura quebraria todo agente que tem uma tool livre.
    await materializar({ kind: 'auto-reject', reason: 'sem humano' })

    const resultado = await despacharToolComoOSdkFaria('read_file')

    expect(resultado.bloqueada).toBe(false)
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('test_o_abort_durante_a_espera_de_aprovacao_NAO_EXECUTA_a_tool', async () => {
    // A única seção deste milestone em que dois fluxos correm juntos: a espera do resolvedor e o
    // encerramento do turn. Um teste de cancelamento que só verifica a rejeição da promessa passaria
    // num sistema que executa a tool e aborta depois — daí o oráculo de D4 também aqui.
    //
    // LIMITE HONESTO: a propagação do `AbortSignal` é do SDK, não desta camada. O que este teste
    // fixa é a propriedade que É desta camada — enquanto a aprovação não resolve, a pausa SEGURA a
    // tool. O espião de `emit` prova que a pausa aconteceu de fato (e não que o caminho nunca foi
    // alcançado), que é a distinção que o seam de D9 torna escrevível.
    const emit = vi.fn()
    const controle = new AbortController()
    await materializar({
      kind: 'interactive',
      emit,
      awaitApproval: () => new Promise(() => {}), // nunca resolve
    })

    const despacho = despacharToolComoOSdkFaria('run_shell')
    const corrida = await Promise.race([
      despacho.then(() => 'despachou'),
      new Promise<string>((r) => {
        controle.abort()
        setTimeout(() => r('abortou'), 20)
      }),
    ])

    expect(corrida, 'o despacho não pode completar enquanto a aprovação está pendente').toBe(
      'abortou',
    )
    expect(emit, 'a pausa tem de ter acontecido de fato').toHaveBeenCalledTimes(1)
    expect(existsSync(sentinela)).toBe(false)
    expect(executor).toHaveBeenCalledTimes(0)
  })

  it('test_o_JSDoc_de_toAgentFactory_nao_declara_mais_o_descarte', async () => {
    // No molde de `agents/m67-docs-truthfulness.test.ts`: uma prosa que descreve um comportamento
    // apagado é a classe de defeito que `adr-governance.md § 5` enumera. Aqui a prosa descrevia um
    // comportamento REAL, e é ela que documentava o buraco.
    const { readFile } = await import('node:fs/promises')
    const fonte = await readFile(
      new URL('../../src/bridge/sdk-adapter.ts', import.meta.url),
      'utf8',
    )
    expect(fonte).not.toContain('not HITL-gated here')
  })
})

describe('M96 D2 — streamAgentTurnInProcess recebe a postura de forma ADITIVA', () => {
  it('test_streamAgentTurnInProcess_sem_approvals_CONTINUA_recusando', () => {
    // A contraprova do D2: o bridge in-process JÁ era fail-closed — é o lado correto da divergência
    // que o M96 existe para fechar. Um aditivo que afrouxasse o único bridge correto seria a
    // regressão mais cara deste plano.
    expect(() => streamAgentTurnInProcess(definicaoGateada(), 'k', { message: 'oi' })).toThrow(
      InProcessApprovalRequiredError,
    )
  })

  it('test_streamAgentTurnInProcess_sob_auto_approve_executa_sem_resolvedor', () => {
    // A metade que o aditivo entrega: a postura permissiva passa a ser EXPRIMÍVEL também ali, em vez
    // de inexprimível de um lado e nomeável do outro.
    expect(() =>
      streamAgentTurnInProcess(definicaoGateada(), 'k', {
        message: 'oi',
        approvals: { kind: 'auto-approve', reason: 'sandbox confina' },
      }),
    ).not.toThrow()
  })

  it('test_NEGATIVO_in_process_sob_owned_by_surface_tambem_dispensa_o_resolvedor', () => {
    expect(() =>
      streamAgentTurnInProcess(definicaoGateada(), 'k', {
        message: 'oi',
        approvals: { kind: 'owned-by-surface', reason: 'a superfície pergunta' },
      }),
    ).not.toThrow()
  })
})

describe('M96 D1 — a omissão deixa de ter forma válida (gate de COMPILAÇÃO)', () => {
  // Estes casos são executados por `pnpm typecheck` (o tsconfig da raiz inclui
  // `packages/*/tests/**/*.ts`): um `@ts-expect-error` que NÃO encontra erro é, ele próprio, um erro
  // de compilação. É o que converte a disciplina em gate em vez de convenção.
  it('test_NEGATIVO_omitir_approvals_reprova_na_compilacao', () => {
    const chamar = () =>
      // @ts-expect-error — `approvals` é obrigatório: a omissão é o defeito que o M96 fecha.
      toAgentFactory(definicaoGateada() as never, { apiKey: 'k' })
    expect(chamar).toBeTypeOf('function')
  })

  it('test_NEGATIVO_interactive_sem_emit_reprova_na_compilacao', () => {
    // D9 — sem o seam, `interactive` não é instalável, e um default no-op devolveria o descarte
    // silencioso pela porta dos fundos.
    // @ts-expect-error — `emit` é obrigatório na variante que emite pedido.
    const postura: ApprovalPosture = { kind: 'interactive', awaitApproval: async () => true }
    expect(postura.kind).toBe('interactive')
  })

  it('test_NEGATIVO_owned_by_surface_sem_razao_reprova_na_compilacao', () => {
    // Um bypass sem justificativa escrita não deve ter forma válida.
    // @ts-expect-error — `reason` é obrigatório na variante de bypass.
    const postura: ApprovalPosture = { kind: 'owned-by-surface' }
    expect(postura.kind).toBe('owned-by-surface')
  })

  it('test_NEGATIVO_uma_variante_inventada_reprova_na_compilacao', () => {
    // A união é FECHADA: o `match` exaustivo é o que faz a postura aparecer em log e em gate.
    // @ts-expect-error — `silent-discard` não é uma postura; era o estado de hoje, sem nome.
    const postura: ApprovalPosture = { kind: 'silent-discard', reason: 'x' }
    expect(postura).toBeDefined()
  })
})
