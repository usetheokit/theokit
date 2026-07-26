/**
 * M79 T2.1 — o CLI está na linha 4.x de `@theokit/agents`, e a razão que dizia o contrário morreu.
 *
 * ## A premissa que este teste enterra
 *
 * O dedup guard do agent-builder (`agents/lib/hooks/hooks-wiring.test.ts:123-124`) afirmava que a
 * segunda cópia de `@theokit/agents` era *"unavoidable"* porque este CLI estava
 * *"still pinned to `@theokit/agents@0.44.x` — **it uses the `agent()` free function M57 removed**"*.
 *
 * Isso deixou de ser verdade em algum momento entre o M57 e hoje, e ninguém percebeu: o comentário
 * ficou, e com ele uma dívida arquitetural inteira — duas majors do mesmo pacote num processo, mais
 * uma allowlist de oito entradas para cercá-la. O próprio ROADMAP herdou a premissa, escrevendo que
 * "subir o CLI é mudança de major com consumidores fora deste repositório".
 *
 * `rules/adr-governance.md § 5` enumera exatamente esta classe como **não mecanizada**: *"um
 * comentário cuja prosa não descreve mais o código"*. Aqui ele não descrevia errado apenas a si — ele
 * sustentava a razão de não consertar.
 *
 * Este teste é o oráculo que faltava: se alguém reintroduzir a free function, ele falha, e a
 * afirmação volta a ser verdadeira **com prova** em vez de por inércia.
 */
import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const raizDoPacote = new URL('../../packages/theo', import.meta.url).pathname

function arquivosTs(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === 'dist') continue
    const caminho = join(dir, entrada)
    if (statSync(caminho).isDirectory()) arquivosTs(caminho, acc)
    else if (caminho.endsWith('.ts') && !caminho.endsWith('.test.ts')) acc.push(caminho)
  }
  return acc
}

describe('M79 T2.1 — o CLI na linha 4.x', () => {
  it('test_o_CLI_declara_agents_pelo_workspace_e_nao_por_pin_velho', () => {
    const pkg = JSON.parse(readFileSync(join(raizDoPacote, 'package.json'), 'utf-8')) as {
      dependencies: Record<string, string>
    }
    const decl = pkg.dependencies['@theokit/agents']

    // `workspace:^` resolve para a versão do monorepo (4.x). Um pin literal `^0.44.x` reintroduziria
    // o skew de quatro majors que este milestone eliminou.
    expect(decl, '`@theokit/agents` precisa vir do workspace, não de um pin publicado antigo').toBe(
      'workspace:^',
    )
  })

  it('test_o_CLI_NAO_usa_a_free_function_agent_removida_no_M57', () => {
    // O gate de veracidade. A afirmação "o CLI usa `agent()`" sustentou a dívida por vários
    // milestones sem nada verificá-la. Agora ela tem oráculo.
    const usos: string[] = []
    for (const arquivo of arquivosTs(join(raizDoPacote, 'src'))) {
      const fonte = readFileSync(arquivo, 'utf-8')
      // Import nomeado da free function a partir do barril — a forma que a removida tinha.
      if (/import\s*\{[^}]*\bagent\b[^}]*\}\s*from\s*['"]@theokit\/agents['"]/.test(fonte)) {
        usos.push(arquivo)
      }
    }

    expect(
      usos,
      `Arquivos importando a free function \`agent()\`: ${usos.join(', ')}. ` +
        'Ela foi removida no M57; usá-la prenderia o CLI à linha 0.44.x e recriaria as duas cópias.',
    ).toEqual([])
  })

  it('test_CONTRAPROVA_o_CLI_de_fato_IMPORTA_do_barril_de_agents', () => {
    // Sem esta, apagar qualquer uso de `@theokit/agents` do CLI passaria no teste acima — e o "não usa a
    // free function" seria verdade por vacuidade, não por correção.
    const importadores = arquivosTs(join(raizDoPacote, 'src')).filter((a) =>
      /from\s*['"]@theokit\/agents['"]/.test(readFileSync(a, 'utf-8')),
    )
    expect(importadores.length, 'o CLI precisa continuar consumindo o barril').toBeGreaterThan(0)
  })
})
