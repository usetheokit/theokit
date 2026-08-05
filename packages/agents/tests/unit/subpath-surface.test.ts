import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SUBPATHS_DE_INFRA,
  enumerarSuperficie,
  enumerarSuperficieDaCamada,
} from '../../scripts/gerar-reexports.mjs'

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

  /**
   * Anti-truncation floor. The number is measured, and it rises when the source grows — 173 until
   * `@theokit/sdk` started exporting `sessionHasWriter` (então `sessaoTemEscritor`, renomeado no
   * `4.39.0`), `transcriptRoot`, `TranscriptBlock` and `TranscriptMessage` from `/persistence`
   * (theokit#161 A), 177 since then — o rename não mexe na contagem, só no nome.
   *
   * Not redundant with the identity gate below: that one compares the snapshot against the LAYER, so
   * a regeneration that produced an empty file from a broken layer would pass on both sides. This one
   * fails a snapshot that shrank, whatever the cause.
   */
  it('test_snapshot_holds_the_177_measured_symbols', () => {
    const total = Object.values(SNAPSHOT).reduce((n, s) => n + s.valores.length + s.tipos.length, 0)
    expect(total).toBe(177)
  })

  /**
   * O CORAÇÃO DO GATE — e o que a primeira versão dele NÃO fazia.
   *
   * Comparava `enumerarSuperficie(spec)` (a FONTE) contra o snapshot. Nunca comparava o que a CAMADA
   * exporta. Resultado medido pela revisão: remover quatro símbolos reais de `/tools` e `/pty` deixava
   * a suíte inteira verde — 98 dos 173 símbolos (57%) sem oráculo nenhum. Foi por essa fresta que
   * `TruncationMode` sumiu da superfície publicada do `4.25.0`.
   *
   * Agora compara os dois lados **contra a fonte**: nada da fonte pode faltar na camada, e nada pode
   * aparecer na camada sem existir na fonte.
   */
  it('test_a_camada_re_exporta_TUDO_que_a_fonte_exporta', async () => {
    const faltando: string[] = []
    for (const [sub, spec] of Object.entries(SUBPATHS_DE_INFRA)) {
      const camada = enumerarSuperficieDaCamada(sub)
      const fonte = await enumerarSuperficie(spec)
      const naCamada = new Set([...camada.valores, ...camada.tipos])
      for (const n of [...fonte.valores, ...fonte.tipos]) {
        if (!naCamada.has(n)) faltando.push(`${sub}: ${n}`)
      }
    }
    expect(
      [...faltando].sort((a, b) => a.localeCompare(b)),
      'SOURCE symbols the layer does not re-export. Regenerate the blocks:\n' +
        '  npx tsx scripts/gerar-reexports.mts\n' +
        'paste them into the `*-entry.ts`, run `npm run build`, then rewrite the snapshot IN THE SAME\n' +
        'commit:\n' +
        '  npx tsx scripts/gerar-reexports.mts --json > tests/unit/__snapshots__/subpath-surface.json',
    ).toEqual([])
  }, 60_000)

  it('test_a_camada_nao_inventa_simbolo_que_a_fonte_nao_tem', async () => {
    const inventados: string[] = []
    for (const [sub, spec] of Object.entries(SUBPATHS_DE_INFRA)) {
      const camada = enumerarSuperficieDaCamada(sub)
      const fonte = await enumerarSuperficie(spec)
      const naFonte = new Set([...fonte.valores, ...fonte.tipos])
      for (const n of [...camada.valores, ...camada.tipos]) {
        if (!naFonte.has(n)) inventados.push(`${sub}: ${n}`)
      }
    }
    expect([...inventados].sort((a, b) => a.localeCompare(b))).toEqual([])
  }, 60_000)

  it('test_a_superficie_de_hoje_e_IDENTICA_ao_snapshot', () => {
    const divergencias: string[] = []
    for (const sub of Object.keys(SUBPATHS_DE_INFRA)) {
      const agora = enumerarSuperficieDaCamada(sub)
      const esperado = SNAPSHOT[sub]
      if (esperado === undefined) {
        divergencias.push(`${sub}: sem entrada no snapshot`)
        continue
      }
      const antes = new Set([...esperado.valores, ...esperado.tipos])
      const hoje = new Set([...agora.valores, ...agora.tipos])
      for (const n of antes) if (!hoje.has(n)) divergencias.push(`${sub}: SUMIU ${n}`)
      for (const n of hoje) if (!antes.has(n)) divergencias.push(`${sub}: NOVO ${n}`)
    }
    expect(
      [...divergencias].sort((a, b) => a.localeCompare(b)),
      'the layer surface changed. If that was intentional, rewrite the snapshot IN THE SAME commit:\n' +
        '  npx tsx scripts/gerar-reexports.mts --json > tests/unit/__snapshots__/subpath-surface.json\n' +
        'the command reproduces the file byte for byte — if `git diff` does not settle at zero after\n' +
        'applying the intended change, a real divergence is left over.',
    ).toEqual([])
  })

  it('test_nenhum_entry_de_infra_usa_export_estrela', () => {
    const comEstrela = Object.keys(SUBPATHS_DE_INFRA).filter((sub) =>
      /^export \* from/m.test(readFileSync(join(RAIZ, 'src', `${sub}-entry.ts`), 'utf8')),
    )
    expect(comEstrela).toEqual([])
  })

  /**
   * Sem `catch { return false }`.
   *
   * A primeira versão engolia a ausência de `dist/` e devolvia verde — num clone limpo sem build, o
   * único teste que olhava o artefato entregue passava por vacuidade. Ausência de build é falha do
   * teste, não sucesso silencioso (`error-handling.md § 2`).
   */
  it('test_o_dist_EMITIDO_existe_e_esta_sem_export_estrela — o que o consumidor ve', () => {
    const semBuild = Object.keys(SUBPATHS_DE_INFRA).filter(
      (sub) => !existsSync(join(RAIZ, 'dist', `${sub}.d.ts`)),
    )
    expect(semBuild, 'rode `npm run build` — sem `dist/` este gate não mede nada').toEqual([])
    const comEstrela = Object.keys(SUBPATHS_DE_INFRA).filter((sub) =>
      /^export \* from/m.test(readFileSync(join(RAIZ, 'dist', `${sub}.d.ts`), 'utf8')),
    )
    expect(comEstrela).toEqual([])
  })
})
