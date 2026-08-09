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
const MARKER = /(?:\/\/|\/\*|^\s*\*)[^\n]*\b(TODO|FIXME|XXX|HACK):/

const EXTENSIONS = ['*.ts', '*.tsx', '*.mts', '*.cts']

/** As raízes de produção e teste da camada — derivadas do índice do git, nunca transcritas. */
function trackedFiles(): string[] {
  // O `git` do PATH é o ponto: este gate pergunta ao índice do repositório em que está rodando.
  // Caminho absoluto quebraria fora do Linux e não fecha ameaça alguma num teste que já executa com
  // os privilégios de quem o invocou.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- ver acima
  const saida = execFileSync('git', ['ls-files', ...EXTENSIONS], {
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
      .filter((f) => !f.endsWith('tests/lint/task-marker.test.ts'))
  )
}

interface Finding {
  readonly file: string
  readonly lineText: number
  readonly text: string
}

function markers(fileList: readonly string[]): Finding[] {
  const findings: Finding[] = []
  for (const file of fileList) {
    let conteudo: string
    try {
      conteudo = readFileSync(file, 'utf8')
    } catch {
      // Um arquivo no índice que sumiu do disco não é um marcador — é um rename em voo.
      continue
    }
    if (!conteudo.includes('TODO:') && !/(FIXME|XXX|HACK):/.test(conteudo)) continue
    const lines = conteudo.split('\n')
    for (const [i, lineText] of lines.entries()) {
      if (MARKER.test(lineText)) findings.push({ file, lineText: i + 1, text: lineText.trim() })
    }
  }
  return findings
}

describe('agent-builder#120 — a task marker in a comment', () => {
  it('test_no_forgotten_task_marker_in_the_layers_source', () => {
    const fileList = trackedFiles()
    expect(
      markers(fileList),
      'dívida marcada em comentário não é rastreada por ninguém — registre em `## Correções` de um ADR ou como resíduo declarado, e remova o marcador',
    ).toEqual([])
  })

  it('test_FLOOR_the_sweep_sees_the_same_as_the_git_index', () => {
    // Sem isto, um filtro quebrado devolveria zero arquivos e o teste acima passaria vazio.
    const fileList = trackedFiles()
    expect(fileList.length).toBeGreaterThan(500)
    expect(fileList.some((f) => f.startsWith('packages/agents/src/'))).toBe(true)
    expect(fileList.some((f) => f.startsWith('tests/'))).toBe(true)
  })

  it('test_NEGATIVE_the_detector_finds_a_synthetic_marker', () => {
    const markerText = ['// ' + 'TODO' + ': trocar isto antes do release'].join('\n')
    expect(MARKER.test(markerText)).toBe(true)
    expect(MARKER.test(' * ' + 'FIXME' + ': idem')).toBe(true)
  })

  it('test_NEGATIVE_the_pt_BR_prose_that_broke_M95_three_times_does_NOT_match', () => {
    for (const prosa of [
      '// o adaptador por onde todo turno passa',
      '// para todo erro do provedor, um código nosso',
      ' * todo estado novo entra por aqui',
    ]) {
      expect(MARKER.test(prosa), prosa).toBe(false)
    }
  })

  it('test_NEGATIVE_a_marker_inside_a_scaffold_string_does_NOT_match', () => {
    // A saída do `theo generate` — marcador para o usuário, não dívida deste repositório.
    expect(MARKER.test("    `    return { message: 'TODO: implement ${name}' }`,")).toBe(false)
  })
})
