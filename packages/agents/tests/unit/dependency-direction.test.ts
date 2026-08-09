/**
 * M79 T1.1 — a direção de dependência: implementação é `dependencies`, não `peer`.
 *
 * ## O que estava invertido
 *
 * `@theokit/agents` tinha **zero `dependencies`** e seis `peerDependencies`, entre elas os três
 * `@theokit/sdk*`. Declarar como peer significa "o host fornece" — e o host, aqui, é o agent-builder,
 * que tem como regra INQUEBRÁVEL **nunca importar `@theokit/sdk*`** (gate
 * `agents/gates/m63-boundary.test.ts`).
 *
 * A consequência era literal: o `package.json` do consumidor declarava, e o npm instalava no topo,
 * exatamente os três pacotes que ele está proibido de usar. Um pacote que o consumidor não pode nem
 * importar não é "substituível pelo host" por definição.
 *
 * ## O que continua peer, e por quê
 *
 * `zod` precisa ser a **mesma instância** que o consumidor usa para criar schemas — duas cópias de
 * zod produzem validadores que não se reconhecem. `ai` é genuinamente trocável (é o SDK de modelo).
 * `@theokit/http` só é usado por quem serve HTTP. Esses três são peer legítimo.
 *
 * O critério é o que a própria DoD enuncia: peer permanece para o **genuinamente substituível**.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const deps = pkg.dependencies ?? {}
const peers = pkg.peerDependencies ?? {}

/** Implementação: o consumidor não pode importar, logo não pode fornecer. */
const IMPLEMENTATION = [
  '@theokit/sdk',
  '@theokit/sdk-tools',
  '@theokit/sdk-pty',
  // O wire (`@theokit/presenter/wire`) é implementação desta camada desde o plano
  // `remover-dependencia-ai`: o consumidor não escolhe qual parser de frame usamos, então não pode
  // fornecê-lo. Externalizado no tsup para que exista UMA instância do schema em runtime.
  '@theokit/presenter',
] as const
/**
 * Genuinamente substituível pelo host.
 *
 * `ai` SAIU desta lista: ele deixou de ser peer porque deixou de ser dependência publicada. O wire
 * é nosso, e o pacote permanece apenas como devDependency — o oráculo do teste diferencial. Um
 * consumidor não precisa mais fornecê-lo, então exigir que fosse peer passou a afirmar o contrário
 * do contrato.
 */
const REPLACEABLE = ['zod', '@theokit/http'] as const

describe('M79 T1.1 — dependency direction', () => {
  it.each(IMPLEMENTATION)('test_%s_e_dependency_e_nao_peer', (nome) => {
    expect(
      deps[nome],
      `\`${nome}\` é implementação desta camada: o consumidor é PROIBIDO de importá-lo pela ` +
        'fronteira INQUEBRÁVEL, então não pode fornecê-lo. Declarar peer obriga o manifesto dele a ' +
        'listar exatamente o que ele não pode usar.',
    ).toBeDefined()
    expect(peers[nome]).toBeUndefined()
  })

  it.each(REPLACEABLE)('test_CONTRAPROVA_%s_continua_peer', (nome) => {
    // Sem esta, mover os SEIS passaria nos testes acima e quebraria o caso do `zod`: duas cópias
    // produzem validadores que não se reconhecem, e o consumidor cria schemas com a dele.
    expect(
      peers[nome],
      `\`${nome}\` é genuinamente substituível pelo host — tem de seguir peer`,
    ).toBeDefined()
    expect(deps[nome]).toBeUndefined()
  })

  it('test_no_package_sits_in_BOTH_places', () => {
    // Um pacote em `dependencies` E `peerDependencies` é ambiguidade de resolução: o npm satisfaz o
    // peer com a própria dep e o aviso some, escondendo qual das duas declarações governa.
    const inBoth = Object.keys(deps).filter((n) => peers[n] !== undefined)
    expect(inBoth, `Declarado em dependencies E peerDependencies: ${inBoth.join(', ')}`).toEqual([])
  })

  it('test_the_layer_no_longer_has_ZERO_dependencies', () => {
    // O estado anterior — zero deps, tudo peer — era a inversão em forma pura: a camada não assumia
    // NADA do que precisa para funcionar.
    expect(Object.keys(deps).length).toBeGreaterThan(0)
  })
})
