import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SUBPATHS_DE_INFRA, enumerarSuperficie } from '../../scripts/gerar-reexports.mjs'

const RAIZ = join(import.meta.dirname, '..', '..')
const SNAPSHOT = JSON.parse(
  readFileSync(join(RAIZ, 'tests/unit/__snapshots__/subpath-surface.json'), 'utf8'),
) as Record<string, { valores: string[]; tipos: string[] }>

/**
 * M90 T0.1/T1.1 — a superfície dos cinco subpaths de infra é um contrato, não um efeito colateral.
 *
 * ## O defeito que este arquivo fecha
 *
 * Até o M90, `tools-entry.ts` inteiro era `export * from '@theokit/sdk-tools'`, e o `dist/tools.d.ts`
 * emitido tinha **uma linha** com a mesma coisa. A camada emprestava o nome sem interpor decisão: um
 * rename upstream se propagava verbatim, **sem erro de build aqui**, e o consumidor descobria em call
 * site. O gate de fronteira do consumidor prende a *string do especificador*, não a superfície de
 * tipos, então ele também não via.
 *
 * ## Por que o snapshot lê o `dist`, e não o `src`
 *
 * O `.d.ts` é o artefato que o consumidor realmente vê. Um snapshot sobre o fonte provaria que
 * escrevemos a lista, não que ela chegou ao pacote — a mesma distinção que o M89 do agent-builder
 * pagou caro para aprender, quando um gate provava que alguém escrevera a raiz numa lista, e não que
 * os arquivos estavam no programa do compilador.
 *
 * ## Por que reusa `enumerarSuperficie` em vez de reimplementar
 *
 * Duas listas que precisam ficar em sincronia são uma violação de DRY com uma afirmação falsa por
 * cima — é o texto do próprio `subpath-coverage.test.ts` (review F-10 do M78), que perdeu `bench` de
 * uma cópia enquanto o comentário jurava "mesmo escopo".
 */
describe('M90 — a superfície dos subpaths de infra está travada', () => {
  it('test_o_snapshot_cobre_os_cinco_subpaths', () => {
    const chaves = Object.keys(SNAPSHOT).sort((a, b) => a.localeCompare(b))
    expect(chaves).toEqual(['interactive', 'persistence', 'pty', 'sandbox', 'tools'])
  })

  it('test_o_snapshot_tem_os_172_simbolos_medidos_no_baseline', () => {
    const total = Object.values(SNAPSHOT).reduce((n, s) => n + s.valores.length + s.tipos.length, 0)
    expect(total).toBe(172)
  })

  it('test_a_superficie_de_hoje_e_IDENTICA_ao_snapshot', async () => {
    const divergencias: string[] = []
    for (const [sub, spec] of Object.entries(SUBPATHS_DE_INFRA)) {
      const agora = await enumerarSuperficie(spec)
      const esperado = SNAPSHOT[sub]
      if (esperado === undefined) {
        divergencias.push(`${sub}: sem entrada no snapshot`)
        continue
      }
      for (const n of esperado.valores) if (!agora.valores.includes(n)) divergencias.push(`${sub}: valor SUMIU ${n}`)
      for (const n of esperado.tipos) if (!agora.tipos.includes(n)) divergencias.push(`${sub}: tipo SUMIU ${n}`)
      for (const n of agora.valores) if (!esperado.valores.includes(n)) divergencias.push(`${sub}: valor NOVO ${n}`)
      for (const n of agora.tipos) if (!esperado.tipos.includes(n)) divergencias.push(`${sub}: tipo NOVO ${n}`)
    }
    expect(
      // Cópia explícita e não `toSorted`: o lint pede `toSorted` (`sonarjs/no-misleading-array-reverse`)
      // mas o `lib` do tsconfig é anterior a es2023 e o `tsc` reprova. Ordenar uma cópia satisfaz os
      // dois — e a intenção (não mutar) é a mesma.
      [...divergencias].sort((a, b) => a.localeCompare(b)),
      'a superfície mudou. Se foi de propósito: regenere com `npx tsx scripts/gerar-reexports.mts --json`,\n' +
        'atualize os `*-entry.ts` e o snapshot no MESMO commit, para a mudança aparecer em diff.',
    ).toEqual([])
  }, 60_000)

  it('test_nenhum_entry_de_infra_usa_export_estrela', () => {
    const comEstrela = Object.keys(SUBPATHS_DE_INFRA).filter((sub) =>
      /^export \* from/m.test(readFileSync(join(RAIZ, 'src', `${sub}-entry.ts`), 'utf8')),
    )
    expect(comEstrela).toEqual([])
  })

  it('test_o_dist_EMITIDO_tambem_esta_sem_export_estrela — o que o consumidor ve', () => {
    const comEstrela = Object.keys(SUBPATHS_DE_INFRA).filter((sub) => {
      const d = join(RAIZ, 'dist', `${sub}.d.ts`)
      try {
        return /^export \* from/m.test(readFileSync(d, 'utf8'))
      } catch {
        return false // sem build ainda — o teste de fonte acima já cobre a intenção
      }
    })
    expect(comEstrela).toEqual([])
  })
})
