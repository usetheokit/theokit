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
const PHASE_1_VERSION = '4.36.0'

/**
 * Compares plain `X.Y.Z` versions. Not a semver library, and does not need to be: both sides here
 * are release versions from this repo's own manifest, with no pre-release or build metadata.
 */
function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => v.split('.').map(Number)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..')

const cwd = mkdtempSync(join(tmpdir(), 'm96-subagent-definition-'))
afterAll(() => rmSync(cwd, { recursive: true, force: true }))

const agentsDir = join(cwd, '.theokit', 'agents')
mkdirSync(agentsDir, { recursive: true })
writeFileSync(
  join(agentsDir, 'analista.md'),
  '---\nname: analista\ndescription: analisa o repo\n---\n\nVocê analisa.\n',
)

describe('M96 U2 — SubagentDefinition alongside the loader', () => {
  it('test_SubagentDefinition_is_exported_from_the_public_index', async () => {
    // O oráculo é a ATRIBUIÇÃO tipada: o `tsc` do repo cobre `packages/*/tests/**/*.ts`, então uma
    // anotação que não casa é erro de compilação, não comentário. A asserção de runtime existe para
    // que o arquivo não seja um `.d.ts` disfarçado.
    const definitions: Record<string, SubagentDefinition> = await discoverSubagents(cwd)
    expect(Object.keys(definitions)).toEqual(['analista'])
    expect(definitions.analista?.description).toBe('analisa o repo')
  })

  it('test_the_branded_AgentDefinition_is_still_the_builders', () => {
    // A CONTRAPROVA da colisão. Sem ela, alguém "resolve" o problema re-exportando o tipo do SDK sob
    // o nome ocupado e quebra todo consumidor do builder em silêncio.
    const doBuilder = AgentBuilder.create()
      .model('claude-sonnet-4-6')
      .system('Você analisa.')
      .build()
    const brandado: AgentDefinition = doBuilder
    expect(brandado).toBeDefined()

    // @ts-expect-error — um objeto de dados SEM a marca não é o `AgentDefinition` do builder.
    const unbranded: AgentDefinition = { description: 'analisa', prompt: 'Você analisa.' }
    expect(unbranded).toBeDefined()
  })

  it('test_the_re_exported_discoverSubagents_carries_the_new_parameter', () => {
    // Medido ATRAVÉS do índice da camada, e não do SDK: é esta asserção que prova o repasse do U3
    // pela cadeia `SDK → Theokit → AgentBuilder`. `options?` é opcional sem default, então conta
    // para `Function.length` — 2 é a aridade da assinatura nova; 1 era a da antiga.
    expect(discoverSubagents.length).toBe(2)
  })

  it('test_the_FLOOR_of_the_sdk_range_is_the_version_that_has_settingSources', () => {
    const manifesto = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
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
    const floor = faixa!.replace(/^[\^~]/, '')
    expect(
      compareVersions(floor, PHASE_1_VERSION),
      `the floor ${floor} is below ${PHASE_1_VERSION}, the first version with settingSources — a ` +
        'fresh install could resolve an SDK that lacks it',
    ).toBeGreaterThanOrEqual(0)
  })

  it('test_the_installed_sdk_actually_accepts_settingSources', async () => {
    // A segunda metade do oráculo: comportamental, independente do manifesto. Uma lista VAZIA lê
    // NADA — o diretório nunca é aberto —, então o `{}` só é possível se o parâmetro existir e for
    // honrado. Contra a versão anterior do SDK, a opção seria ignorada e viria `{ analista }`.
    const none = await discoverSubagents(cwd, { settingSources: [] })
    expect(none).toEqual({})

    // O par invertido, que impede o teste acima de "provar" a leitura por nunca ler nada.
    const ofTheProject = await discoverSubagents(cwd, { settingSources: ['project'] })
    expect(Object.keys(ofTheProject)).toEqual(['analista'])
  })

  it('test_NEGATIVE_the_alias_does_not_resolve_to_the_branded_type', () => {
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
