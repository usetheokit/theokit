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

/**
 * M110 — o device flow **RFC 8628**, pelo MESMO argumento do M73, sobre símbolos que ele não cobriu.
 *
 * Medido antes de re-exportar: o SDK implementa o padrão e este subpath re-exportava **apenas** a
 * variante da OpenAI. Um consumidor que precisasse do RFC tinha duas saídas — violar a fronteira
 * INQUEBRÁVEL, ou reimplementar o protocolo. A segunda é legal, e é exatamente a classe de defeito
 * que o M73 documenta ter custado ~120 linhas duplicadas noutro subsistema.
 *
 * Estes entram na MESMA bateria de `toBe` de propósito: pass-through puro tem um só oráculo, e é a
 * identidade de referência. Uma lista separada com asserção mais fraca seria um segundo oráculo sobre
 * o mesmo fato.
 */
const DEVICE_FLOW_PADRAO = [
  'deviceLogin',
  'requestDeviceCode',
  'pollDeviceToken',
  // `openaiDeviceLogin` entra AQUI, e a review do M110 mediu por que isso importa: envolvê-lo num
  // wrapper passava a bateria inteira (21/21, EXIT=0). Ele era checado só por `toBeDefined` e por
  // `not.toBe(deviceLogin)` — nenhum dos dois vê um wrapper.
  //
  // Era o símbolo que o milestone existe para tornar alcançável, e o único sem a trava forte.
  'openaiDeviceLogin',
] as const

/**
 * M112 — the OAuth ENGINE (exchange / refresh / persist), by the SAME argument as M73 and M110, over
 * the subsystem neither of them covered.
 *
 * Measured in the TheoCode ↔ theokit cross-validation of 2026-08-07: `@theokit/sdk/auth` exports
 * `ensureFreshCredential`, `persistOAuthTokens`, `refreshOAuthTokens` and `extractAccountId`; this
 * subpath re-exported NONE of the four. The consumer, which cannot import `@theokit/sdk*` directly,
 * did the only legal thing left — it rewrote the mechanics by hand (TheoCode's
 * `packages/agent/src/auth/credentials.ts`, finding SAC-07).
 *
 * This is the third re-enactment of the SAME M73 sentence: *"the gap was ours, not their
 * indiscipline"*. The pattern already cost ~120 duplicated lines in M73 and the whole RFC protocol
 * in M110.
 *
 * `extractAccountId` comes along because it is the natural pair of refresh: whoever persists tokens
 * needs to know which account they belong to, and the alternative is the consumer decoding the JWT
 * on its own.
 */
const OAUTH_ENGINE = [
  'ensureFreshCredential',
  'persistOAuthTokens',
  'refreshOAuthTokens',
  'extractAccountId',
] as const

const PASS_THROUGH = [...MECANICA_DE_STORE, ...DEVICE_FLOW_PADRAO, ...OAUTH_ENGINE] as const

describe('M112 — `resolveCredential` still does NOT cross over, on purpose', () => {
  it('test_resolveCredential_does_not_cross_the_layer', () => {
    // The deliberate exception `auth-entry.ts` has documented since M73: the SDK and the consumer
    // have DIFFERENT functions under that name (sync vs async, throws vs `undefined`, reads env vs
    // does not, infers provider vs refuses), and the SDK itself declares that env precedence, prefix
    // inference and the declared provider are the consumer's **app policy**.
    //
    // This test exists because M112 opens the neighbouring subsystem: without an explicit lock, the
    // next milestone that "completes the auth pass-through" adds it out of symmetry, and the consumer
    // ends up with two identical names of divergent semantics in one scope — a silent failure, which
    // is exactly what the original decision avoids.
    expect(
      (camada as Record<string, unknown>).resolveCredential,
      '`resolveCredential` started crossing the layer. The omission is DELIBERATE and documented in ' +
        '`src/auth-entry.ts`: two functions share this name with divergent semantics. Exposing both ' +
        'in one scope invites importing the wrong one, silently.',
    ).toBeUndefined()
  })
})

describe('M110 — a camada NÃO esconde o device flow padrão atrás da variante da OpenAI', () => {
  it('test_a_variante_da_OPENAI_continua_atravessando', () => {
    // PISO ANTI-VACUIDADE: se nenhuma das duas atravessasse, "o padrão atravessa" seria satisfeito
    // por um subpath vazio. E o Codex é o provider que este trabalho existe para facilitar — perdê-lo
    // enquanto se abre o padrão inverteria o resultado.
    expect(
      camada.openaiDeviceLogin,
      'a variante da OpenAI parou de atravessar — o Codex ficou inalcançável',
    ).toBeDefined()
  })

  it('test_as_DUAS_formas_coexistem_e_sao_DISTINTAS', () => {
    // Fundir os dois protocolos quebraria o Codex: o RFC tem UM `deviceCodeEndpoint`; a OpenAI tem
    // DOIS (`deviceUsercodeEndpoint` → `devicePollEndpoint`, com PKCE). Este teste falha se alguém
    // "simplificar" apontando os dois nomes para a mesma função.
    expect(
      camada.deviceLogin,
      'o flow padrão e o da OpenAI viraram a mesma referência — os protocolos são diferentes, e ' +
        'unificá-los quebra o Codex',
    ).not.toBe(camada.openaiDeviceLogin)
  })
})

describe('M73 — @theokit/agents/auth deixa a mecânica de store atravessar', () => {
  it.each(PASS_THROUGH)('test_a_camada_reexporta_%s_do_sdk', (nome) => {
    expect(
      (camada as Record<string, unknown>)[nome],
      `\`${nome}\` não atravessa a camada. O consumidor não pode importar \`@theokit/sdk*\` direto ` +
        '(fronteira INQUEBRÁVEL), então sem este re-export a única saída legal dele é reimplementar — ' +
        'que é exatamente como seis nomes idênticos foram parar no agent-builder.',
    ).toBeDefined()
  })

  it.each(PASS_THROUGH)('test_%s_e_a_MESMA_referencia_do_sdk', (nome) => {
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
