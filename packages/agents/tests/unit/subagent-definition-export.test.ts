/**
 * M96 U2 (Fase 2) — `SubagentDefinition` publicado ao lado do carregador.
 *
 * ## O defeito
 *
 * `packages/agents/src/index.ts` já re-exporta `discoverSubagents` do SDK, mas não o TIPO que essa
 * função devolve. O nome natural — `AgentDefinition` — está **ocupado** no mesmo índice: em
 * `bridge/index.ts` ele é o tipo BRANDADO do builder (`[AGENT_BRAND]: true`). Um consumidor que
 * escrevesse `import type { AgentDefinition } from '@theokit/agents'` para nomear o retorno de
 * `discoverSubagents` receberia, em silêncio, o tipo errado — e a única saída restante era
 * redeclarar a forma à mão, que é exatamente a duplicação que o M81 existiu para apagar.
 *
 * O alias resolve a colisão sem tocar no nome ocupado, que é literalmente o par que o peer publica
 * (`gemini-cli/packages/core/src/index.ts:191-192`: o carregador e o tipo, vizinhos).
 *
 * ## Por que o teste de PISO compara string, e não `satisfies` (ADR D11)
 *
 * A versão anterior deste oráculo afirmava PERTINÊNCIA (*"o intervalo inclui a versão"*), e era
 * vacuosa por medição: `semver.satisfies('4.36.0', '^4.35.0') === true`. Ela passaria com o
 * especificador intocado em `^4.35.0` — a versão que **não tem** `settingSources`. Um gate que não
 * pode falhar não é um gate; é uma afirmação.
 *
 * A comparação é de string porque `require.resolve('semver')` FALHA na raiz deste monorepo (medido),
 * e o piso de um caret range é o literal após o `^` — acrescentar dependência para ler um prefixo é
 * a `parsimony-ladder.md` pelo avesso.
 *
 * ## Por que existem DOIS oráculos para a mesma dependência
 *
 * O do manifesto prova o que está DECLARADO; o comportamental prova o que está INSTALADO. Um
 * manifesto correto sobre uma árvore velha é um falso verde, e só o segundo o fecha.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { AgentBuilder, discoverSubagents } from '../../src/index.js'
import type { AgentDefinition, SubagentDefinition } from '../../src/index.js'

/** A versão do SDK publicada na Fase 1 — a primeira que tem `settingSources` (D11). */
const VERSAO_DA_FASE_1 = '4.36.0'

/**
 * Compares plain `X.Y.Z` versions. Not a semver library, and does not need to be: both sides here
 * are release versions from this repo's own manifest, with no pre-release or build metadata.
 */
function ordemDeVersao(a: string, b: string): number {
  const partes = (v: string): number[] => v.split('.').map(Number)
  const [x, y] = [partes(a), partes(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

const RAIZ_DO_PACOTE = join(import.meta.dirname, '..', '..')

const cwd = mkdtempSync(join(tmpdir(), 'm96-subagent-definition-'))
afterAll(() => rmSync(cwd, { recursive: true, force: true }))

const dirAgentes = join(cwd, '.theokit', 'agents')
mkdirSync(dirAgentes, { recursive: true })
writeFileSync(
  join(dirAgentes, 'analista.md'),
  '---\nname: analista\ndescription: analisa o repo\n---\n\nVocê analisa.\n',
)

describe('M96 U2 — SubagentDefinition ao lado do carregador', () => {
  it('test_SubagentDefinition_e_exportado_pelo_indice_publico', async () => {
    // O oráculo é a ATRIBUIÇÃO tipada: o `tsc` do repo cobre `packages/*/tests/**/*.ts`, então uma
    // anotação que não casa é erro de compilação, não comentário. A asserção de runtime existe para
    // que o arquivo não seja um `.d.ts` disfarçado.
    const definicoes: Record<string, SubagentDefinition> = await discoverSubagents(cwd)
    expect(Object.keys(definicoes)).toEqual(['analista'])
    expect(definicoes.analista?.description).toBe('analisa o repo')
  })

  it('test_o_AgentDefinition_brandado_continua_sendo_o_do_builder', () => {
    // A CONTRAPROVA da colisão. Sem ela, alguém "resolve" o problema re-exportando o tipo do SDK sob
    // o nome ocupado e quebra todo consumidor do builder em silêncio.
    const doBuilder = AgentBuilder.create()
      .model('claude-sonnet-4-6')
      .system('Você analisa.')
      .build()
    const brandado: AgentDefinition = doBuilder
    expect(brandado).toBeDefined()

    // @ts-expect-error — um objeto de dados SEM a marca não é o `AgentDefinition` do builder.
    const semMarca: AgentDefinition = { description: 'analisa', prompt: 'Você analisa.' }
    expect(semMarca).toBeDefined()
  })

  it('test_discoverSubagents_reexportado_carrega_o_parametro_novo', () => {
    // Medido ATRAVÉS do índice da camada, e não do SDK: é esta asserção que prova o repasse do U3
    // pela cadeia `SDK → Theokit → AgentBuilder`. `options?` é opcional sem default, então conta
    // para `Function.length` — 2 é a aridade da assinatura nova; 1 era a da antiga.
    expect(discoverSubagents.length).toBe(2)
  })

  it('test_o_PISO_da_faixa_de_sdk_e_a_versao_que_tem_settingSources', () => {
    const manifesto = JSON.parse(readFileSync(join(RAIZ_DO_PACOTE, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const faixa = manifesto.dependencies['@theokit/sdk']
    expect(faixa).toBeDefined()
    // FLOOR, never membership (D11): `^4.35.0` "includes" 4.36.0 and still permits installing the
    // version without `settingSources`.
    //
    // Asserted as `>=`, not `==`. Equality read the floor as "exactly the version that introduced
    // settingSources", which is not what D11 says and made the assertion fail on every legitimate
    // raise: M107 review HIGH-2 moved the floor to 4.37.0 because 4.36.0 silently ignores the `cwd`
    // that `Agent.list` advertises, and this test went red for guarding the opposite of its purpose.
    // A floor BELOW the settingSources version is the defect; a floor above it is the mechanism.
    const piso = faixa!.replace(/^[\^~]/, '')
    expect(
      ordemDeVersao(piso, VERSAO_DA_FASE_1),
      `the floor ${piso} is below ${VERSAO_DA_FASE_1}, the first version with settingSources — a ` +
        'fresh install could resolve an SDK that lacks it',
    ).toBeGreaterThanOrEqual(0)
  })

  it('test_o_sdk_instalado_de_fato_aceita_settingSources', async () => {
    // A segunda metade do oráculo: comportamental, independente do manifesto. Uma lista VAZIA lê
    // NADA — o diretório nunca é aberto —, então o `{}` só é possível se o parâmetro existir e for
    // honrado. Contra a versão anterior do SDK, a opção seria ignorada e viria `{ analista }`.
    const nenhuma = await discoverSubagents(cwd, { settingSources: [] })
    expect(nenhuma).toEqual({})

    // O par invertido, que impede o teste acima de "provar" a leitura por nunca ler nada.
    const doProjeto = await discoverSubagents(cwd, { settingSources: ['project'] })
    expect(Object.keys(doProjeto)).toEqual(['analista'])
  })

  it('test_NEGATIVO_o_alias_nao_resolve_para_o_tipo_brandado', () => {
    // A lente que impede o alias de virar sinônimo do nome ocupado: o valor do builder não tem
    // `description`/`prompt`, que a definição de subagent EXIGE.
    const doBuilder = AgentBuilder.create()
      .model('claude-sonnet-4-6')
      .system('Você analisa.')
      .build()
    // @ts-expect-error — o brandado do builder não é uma definição de subagent.
    const comoSubagent: SubagentDefinition = doBuilder
    expect(comoSubagent).toBeDefined()
  })
})
