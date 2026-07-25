/**
 * M73 — "enriquecer nunca reduz": a camada re-exporta a mecânica de store do SDK.
 *
 * ## Por que este arquivo existe
 *
 * `@theokit/sdk/auth` exporta 19 símbolos; `@theokit/agents/auth` exportava **1 valor e 6 tipos** —
 * `AuthProvider` mais os tipos do domínio. **Zero funções atravessavam.**
 *
 * Isso não é um detalhe de conveniência. O consumidor (`agent-builder`) tem como regra INQUEBRÁVEL
 * nunca importar `@theokit/sdk*` direto: toda superfície do SDK precisa chegar por esta camada. Sem o
 * re-export, **reimplementar era a única saída legal** — e foi o que aconteceu: seis nomes idênticos
 * (`credentialHome`, `authFilePath`, `CredentialError`, `readStoredOAuth`, `resolveCredential`,
 * `writeCredential`) reescritos lá, ~120 linhas de mecânica de store duplicada.
 *
 * O defeito não era indisciplina do consumidor. Era uma lacuna aqui que só deixava uma porta aberta.
 *
 * ## Por que pass-through PURO, e não um wrapper
 *
 * A camada existe para ENRIQUECER (parsimony Rung 9): ela acrescenta OO onde há estado ou orquestração
 * a segurar — é o que `AuthProvider` faz com o par `config`+`store`. A mecânica de store é função pura
 * de I/O: envolvê-la só acrescentaria uma camada de indireção sem nada dentro.
 *
 * ## O que este teste protege que ninguém veria quebrar
 *
 * `instanceof`. O consumidor faz `err instanceof CredentialError` no caminho de login. Enquanto a
 * classe for **a mesma referência** do SDK, isso funciona. Se um dia o build inlinear o SDK
 * (`noExternal` no tsup), a camada passa a exportar uma **cópia** da classe: `instanceof` vira `false`
 * silenciosamente, o erro tipado deixa de ser reconhecido, e **nenhum teste de comportamento fica
 * vermelho**. Por isso a asserção é de identidade referencial (`toBe`), não de forma.
 */
import { describe, expect, it } from 'vitest'

import * as camada from '../../src/auth-entry.js'
import * as sdk from '@theokit/sdk/auth'

/** A mecânica de store — o que o SDK possui e o que a camada precisa deixar atravessar. */
const MECANICA_DE_STORE = [
  'credentialHome',
  'authFilePath',
  'CredentialError',
  'readAuthFile',
  'readStoredOAuth',
  'writeCredential',
] as const

describe('M73 — @theokit/agents/auth deixa a mecânica de store atravessar', () => {
  it.each(MECANICA_DE_STORE)('test_a_camada_reexporta_%s_do_sdk', (nome) => {
    expect(
      (camada as Record<string, unknown>)[nome],
      `\`${nome}\` não atravessa a camada. O consumidor não pode importar \`@theokit/sdk*\` direto ` +
        '(fronteira INQUEBRÁVEL), então sem este re-export a única saída legal dele é reimplementar — ' +
        'que é exatamente como seis nomes idênticos foram parar no agent-builder.',
    ).toBeDefined()
  })

  it.each(MECANICA_DE_STORE)('test_%s_e_a_MESMA_referencia_do_sdk', (nome) => {
    // `toBe`, não `toBeDefined`: pass-through PURO. Um wrapper passaria no teste anterior e falharia
    // aqui — e é o wrapper que quebra `instanceof` sem nada ficar vermelho.
    expect(
      (camada as Record<string, unknown>)[nome],
      `\`${nome}\` existe na camada mas NÃO é a mesma referência do SDK. Ou virou wrapper, ou o build ` +
        'inlineou o SDK. Para uma CLASSE isso quebra `instanceof` em silêncio no consumidor; para uma ' +
        'função, faz a camada divergir do que o SDK garante.',
    ).toBe((sdk as Record<string, unknown>)[nome])
  })

  it('test_CredentialError_preserva_instanceof_atraves_da_camada', () => {
    // O caso concreto: `agents/lib/auth/login.ts:48` do consumidor faz `err instanceof CredentialError`
    // com a classe importada DAQUI, contra um erro lançado pelo SDK. Só funciona com um realm só.
    const lancadoPeloSdk = new sdk.CredentialError('erro de teste')
    expect(
      lancadoPeloSdk instanceof camada.CredentialError,
      'a classe exportada pela camada não reconhece um erro lançado pelo SDK — há dois realms, e o ' +
        '`instanceof` do consumidor falha em silêncio',
    ).toBe(true)
  })
})
