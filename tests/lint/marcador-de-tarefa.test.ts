import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * agent-builder#120 — o marcador de tarefa esquecido volta a ter sinal, sem a palavra `todo`.
 *
 * ## Por que a regra do lint saiu, e por que isto entrou no lugar
 *
 * `sonarjs/todo-tag` casa **TODO em qualquer caixa**, e `todo` é palavra comum do português. Ela
 * derrubou o build da camada **três vezes no M95**, sempre em prosa legítima — *"por onde todo turno
 * passa"*, *"para todo erro"*. A medição que fechou a decisão: marcadores **reais** no fonte da
 * camada → **0**. Zero verdadeiros positivos contra três falsos é custo permanente com benefício
 * nulo, então a regra foi desligada (`eslint.config.js`).
 *
 * O que ficou de resíduo, e é a razão deste arquivo: com ela desligada, um `// TODO:` **genuíno**
 * deixou de ser sinalizado, e o controle substituto passou a ser **convenção** — dívida em
 * `## Correções` de ADR e resíduo declarado no código. Convenção não é enforcement; um controle que
 * depende de alguém lembrar falha por **omissão**.
 *
 * ## O que este gate casa, e por que essa forma
 *
 * Só a forma que um marcador de verdade tem: **maiúscula + dois-pontos**, e **dentro de comentário**.
 *
 * | Texto | Casa? | Por quê |
 * |---|---|---|
 * | `// TODO: trocar isto` | sim | é um marcador |
 * | `// por onde todo turno passa` | não | minúscula, sem dois-pontos — os 3 falsos do M95 |
 * | `` `return { message: 'TODO: implement ${name}' }` `` | não | não é comentário: é a **saída** do
 *   gerador de scaffold do `theo generate`, um marcador para o usuário, não dívida daqui |
 *
 * A terceira linha é o motivo de exigir o comentário em vez de varrer o texto cru: as duas únicas
 * ocorrências de `TODO:` no repositório hoje são exatamente ela, e um gate que as acusasse nasceria
 * vermelho por ruído — e um gate que nasce vermelho é desligado na semana seguinte.
 *
 * ## O piso anti-vacuidade
 *
 * Uma varredura que devolve zero passa verde, e é indistinguível de uma que não sabe procurar. Dois
 * testes negativos abaixo matam essa ambiguidade: o detector **acha** um marcador sintético, e a
 * varredura **enxerga** o mesmo número de arquivos que o índice do git reporta.
 */

/** Maiúscula + dois-pontos, dentro de um comentário `//` ou `/* ... `. */
const MARCADOR = /(?:\/\/|\/\*|^\s*\*)[^\n]*\b(TODO|FIXME|XXX|HACK):/

const EXTENSOES = ['*.ts', '*.tsx', '*.mts', '*.cts']

/** As raízes de produção e teste da camada — derivadas do índice do git, nunca transcritas. */
function arquivosVersionados(): string[] {
  // O `git` do PATH é o ponto: este gate pergunta ao índice do repositório em que está rodando.
  // Caminho absoluto quebraria fora do Linux e não fecha ameaça alguma num teste que já executa com
  // os privilégios de quem o invocou.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- ver acima
  const saida = execFileSync('git', ['ls-files', ...EXTENSOES], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
  return (
    saida
      .trim()
      .split('\n')
      .filter((f) => f.length > 0)
      .filter(
        (f) => f.startsWith('packages/') || f.startsWith('tests/') || f.startsWith('scripts/'),
      )
      .filter((f) => !f.includes('/templates/') && !f.includes('/dist/'))
      // Este próprio arquivo escreve os marcadores na prosa que os explica.
      .filter((f) => !f.endsWith('tests/lint/marcador-de-tarefa.test.ts'))
  )
}

interface Achado {
  readonly arquivo: string
  readonly linha: number
  readonly texto: string
}

function marcadores(arquivos: readonly string[]): Achado[] {
  const achados: Achado[] = []
  for (const arquivo of arquivos) {
    let conteudo: string
    try {
      conteudo = readFileSync(arquivo, 'utf8')
    } catch {
      // Um arquivo no índice que sumiu do disco não é um marcador — é um rename em voo.
      continue
    }
    if (!conteudo.includes('TODO:') && !/(FIXME|XXX|HACK):/.test(conteudo)) continue
    const linhas = conteudo.split('\n')
    for (const [i, linha] of linhas.entries()) {
      if (MARCADOR.test(linha)) achados.push({ arquivo, linha: i + 1, texto: linha.trim() })
    }
  }
  return achados
}

describe('agent-builder#120 — marcador de tarefa em comentário', () => {
  it('test_nenhum_marcador_de_tarefa_esquecido_no_fonte_da_camada', () => {
    const arquivos = arquivosVersionados()
    expect(
      marcadores(arquivos),
      'dívida marcada em comentário não é rastreada por ninguém — registre em `## Correções` de um ADR ou como resíduo declarado, e remova o marcador',
    ).toEqual([])
  })

  it('test_PISO_a_varredura_enxerga_o_mesmo_que_o_indice_do_git', () => {
    // Sem isto, um filtro quebrado devolveria zero arquivos e o teste acima passaria vazio.
    const arquivos = arquivosVersionados()
    expect(arquivos.length).toBeGreaterThan(500)
    expect(arquivos.some((f) => f.startsWith('packages/agents/src/'))).toBe(true)
    expect(arquivos.some((f) => f.startsWith('tests/'))).toBe(true)
  })

  it('test_NEGATIVO_o_detector_acha_um_marcador_sintetico', () => {
    const marcador = ['// ' + 'TODO' + ': trocar isto antes do release'].join('\n')
    expect(MARCADOR.test(marcador)).toBe(true)
    expect(MARCADOR.test(' * ' + 'FIXME' + ': idem')).toBe(true)
  })

  it('test_NEGATIVO_a_prosa_pt_BR_que_derrubou_o_M95_tres_vezes_NAO_casa', () => {
    for (const prosa of [
      '// o adaptador por onde todo turno passa',
      '// para todo erro do provedor, um código nosso',
      ' * todo estado novo entra por aqui',
    ]) {
      expect(MARCADOR.test(prosa), prosa).toBe(false)
    }
  })

  it('test_NEGATIVO_o_marcador_dentro_de_string_de_scaffold_NAO_casa', () => {
    // A saída do `theo generate` — marcador para o usuário, não dívida deste repositório.
    expect(MARCADOR.test("    `    return { message: 'TODO: implement ${name}' }`,")).toBe(false)
  })
})
