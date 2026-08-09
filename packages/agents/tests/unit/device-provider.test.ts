import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CODEX_PROVIDER,
  deviceLogin,
  loginWithDevice,
  openaiDeviceLogin,
  type AuthMethod,
  type CredentialStoreConfig,
  type DeviceAuthProvider,
} from '../../src/auth-entry.js'

/**
 * M111 — device auth plug-and-play: o provider é um objeto com métodos ROTULADOS, e um login cabe
 * numa chamada.
 *
 * ## O que este arquivo prova
 *
 * O M110 tornou o RFC 8628 **alcançável**. Ele não tocou a ergonomia: para autenticar no Codex, o
 * consumidor precisava saber que existem duas formas de device flow, copiar um `clientId` e três URLs
 * da OpenAI, montar `{fetch, sleep, now}`, chamar `deviceLogin` e **lembrar** de chamar `persist`.
 * Esquecer o último custa um round-trip OAuth completo que não guarda nada.
 *
 * ## As decisões que estas asserções travam
 *
 * O discover do M111 mediu três peers (`codex`, `opencode`, `gemini-cli`) e **rejeitou** parte da
 * proposta original:
 *
 * - **Rejeitado — discriminante `kind`.** Nenhum dos três discrimina protocolo por campo. A medição
 *   que fecha o caso: no `opencode`, browser e headless do Codex carregam o **mesmo** `type: "oauth"`
 *   (3 `oauth` + 1 `api` no arquivo), logo o `type` classifica **espécie de credencial**, não
 *   protocolo. Um `kind` com despacho interno seria o `switch` que o milestone existe para remover.
 *   Cada método aponta para a **sua** função; `test_the_two_shapes_are_NOT_the_same_function` reprova a
 *   fusão.
 * - **Confirmado — Facade.** `codex/codex-rs/login/src/device_code_auth.rs:234` tem
 *   `run_device_code_login`, que retorna `()` — nada sai para o chamador persistir — e mantém as duas
 *   metades públicas. `loginWithDevice` é a cópia dessa forma.
 * - **Confirmado — identidade junto do flow.** `codex` exporta `CLIENT_ID` do crate que implementa
 *   (`login/src/lib.rs:32`) e o CLI o **importa**; o `opencode` o declara dentro do plugin. Os dois,
 *   independentemente, e com o mesmo valor que o consumidor tinha copiado.
 *
 * ## Por que `AuthMethod` é união discriminada e não um campo opcional
 *
 * `authorize?:` opcional tornaria `{ label, type: 'oauth' }` representável — um método OAuth que não
 * sabe autorizar, detectado só em runtime, no meio do login do usuário. É exatamente a alternativa que
 * o blueprint do M110 já havia rejeitado por escrito. A união a barra no compilador.
 */
describe('M111 — a provider with labelled methods', () => {
  let home: string

  const store = (): CredentialStoreConfig => ({
    home,
    dirName: '.m111',
    fileName: 'auth.json',
    homeEnvVar: 'M111_HOME',
  })

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'm111-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('test_floor_the_layer_publishes_the_M111_symbols', () => {
    // PISO ANTI-VACUIDADE: sem ele, um import que resolvesse para `undefined` faria as asserções
    // abaixo falharem por motivo errado, e um teste que falha por motivo errado não distingue
    // "a camada não expõe" de "o provider está mal montado".
    expect(typeof loginWithDevice, '`loginWithDevice` não atravessa a camada').toBe('function')
    expect(CODEX_PROVIDER, '`CODEX_PROVIDER` não atravessa a camada').toBeDefined()
  })

  it('test_CODEX_PROVIDER_is_frozen_and_carries_the_public_identity', () => {
    // Congelado porque é identidade pública COMPARTILHADA: um consumidor que a mutasse mudaria o
    // login de todos os outros no mesmo processo.
    expect(Object.isFrozen(CODEX_PROVIDER), 'o provider não está congelado').toBe(true)
    expect(Object.isFrozen(CODEX_PROVIDER.methods), 'a lista de métodos não está congelada').toBe(
      true,
    )
    // A identidade que ANTES morava no consumidor (agent-builder) — é o defeito D2 do milestone.
    expect(CODEX_PROVIDER.oauth.clientId, 'o clientId público não atravessa').toBe(
      'app_EMoamEEZ73f0CkXaXp7hrann',
    )
    expect(CODEX_PROVIDER.oauth.provider).toBe('openai')
  })

  it('test_the_methods_are_LABELLED_and_cover_oauth_and_api_key', () => {
    // O rótulo é o que fecha o pedido que abriu o milestone: transforma escolha de protocolo em
    // escolha de frase legível. Os três peers convergem em métodos rotulados.
    const labels = CODEX_PROVIDER.methods.map((m) => m.label)
    expect(labels.length, 'o provider não declara métodos').toBeGreaterThanOrEqual(2)
    for (const l of labels)
      expect(l.length, 'um método sem rótulo é invisível na UI').toBeGreaterThan(0)
    expect(
      CODEX_PROVIDER.methods.some((m) => m.type === 'oauth'),
      'nenhum método OAuth — o device login sumiu',
    ).toBe(true)
    expect(
      CODEX_PROVIDER.methods.some((m) => m.type === 'api'),
      'nenhum método de chave — a TUI continuaria dizendo "use an API key" sem oferecer caminho',
    ).toBe(true)
  })

  it('test_every_oauth_method_HAS_authorize_and_the_api_key_one_does_NOT', () => {
    // A metade de runtime da união discriminada. O compilador barra `{label, type:'oauth'}`; esta
    // asserção barra o mesmo defeito chegando por JS sem tipos.
    for (const m of CODEX_PROVIDER.methods) {
      if (m.type === 'oauth') {
        expect(typeof m.authorize, `método oauth "${m.label}" sem authorize`).toBe('function')
      } else {
        expect('authorize' in m, `método api "${m.label}" não deve carregar authorize`).toBe(false)
      }
    }
  })

  it('test_the_two_shapes_are_NOT_the_same_function', () => {
    // Fundir quebraria o Codex: o RFC 8628 tem UM `deviceCodeEndpoint`; a variante da OpenAI tem DOIS
    // (`deviceUsercodeEndpoint` → `devicePollEndpoint`, com PKCE). Reprova se alguém "simplificar".
    expect(typeof deviceLogin).toBe('function')
    expect(typeof openaiDeviceLogin).toBe('function')
    expect(
      deviceLogin as unknown,
      'o flow padrão e o da OpenAI viraram a mesma referência — os protocolos diferem',
    ).not.toBe(openaiDeviceLogin as unknown)
  })

  it('test_loginWithDevice_persists_and_returns_a_PATH_never_a_token', async () => {
    // O Facade: uma chamada. O teste NÃO chama `persist` — se a credencial não estiver no disco ao
    // fim, o Facade não é Facade.
    const metodo: AuthMethod = {
      label: 'sintético',
      type: 'oauth',
      authorize: async () => ({
        access: 'TOKEN-DE-ACESSO',
        refresh: 'TOKEN-REFRESH',
        expires: 1_700_000_000_000,
        accountId: 'conta-1',
      }),
    }
    const provider: DeviceAuthProvider = {
      name: 'sintetico',
      oauth: CODEX_PROVIDER.oauth,
      methods: [metodo],
    }

    const r = await loginWithDevice(provider, metodo, store(), { onPrompt: () => {} })

    expect(r.path, 'o Facade não devolveu o caminho').toContain('auth.json')
    expect(
      existsSync(r.path),
      'a credencial não foi persistida — o consumidor teria de chamar persist',
    ).toBe(true)
    expect(r.accountId).toBe('conta-1')
    // Material de token NUNCA sai no retorno — nem em chave, nem em valor.
    const serializado = JSON.stringify(r)
    expect(serializado, 'o retorno vazou o access token').not.toContain('TOKEN-DE-ACESSO')
    expect(serializado, 'o retorno vazou o refresh token').not.toContain('TOKEN-REFRESH')
    // …mas o disco TEM o token: sem esta asserção, "não vazou" seria satisfeito por não persistir nada.
    expect(readFileSync(r.path, 'utf8'), 'o token não chegou ao store').toContain('TOKEN-DE-ACESSO')
  })

  it('test_omitting_deps_uses_the_defaults', async () => {
    // ADR-5: `deps` opcional. Os três peers não exigem deps no caminho feliz; a injeção fica para o
    // teste. Esta chamada não passa o 5º argumento.
    const metodo: AuthMethod = {
      label: 'sintético',
      type: 'oauth',
      authorize: async () => ({ access: 'A', refresh: 'R', expires: 1 }),
    }
    const provider: DeviceAuthProvider = {
      name: 's',
      oauth: CODEX_PROVIDER.oauth,
      methods: [metodo],
    }
    await expect(
      loginWithDevice(provider, metodo, store(), { onPrompt: () => {} }),
    ).resolves.toBeDefined()
  })

  it('test_NEGATIVE_a_method_from_ANOTHER_provider_fails_typed_and_writes_nothing', async () => {
    // A assinatura aceita `provider` e `method` independentemente; nada estrutural impede passar um
    // método que o provider não declara. Validar na fronteira — e provar que o store fica intacto,
    // porque falhar DEPOIS de gravar é pior que falhar.
    const foreign: AuthMethod = {
      label: 'de outro provider',
      type: 'oauth',
      authorize: async () => ({ access: 'X', refresh: 'Y', expires: 1 }),
    }
    const provider: DeviceAuthProvider = {
      name: 'sintetico',
      oauth: CODEX_PROVIDER.oauth,
      methods: [{ label: 'o único que ele tem', type: 'api' }],
    }
    const s = store()
    await expect(loginWithDevice(provider, foreign, s, { onPrompt: () => {} })).rejects.toThrow(
      /não pertence|does not belong/i,
    )
    expect(existsSync(join(home, '.m111', 'auth.json')), 'gravou credencial apesar de falhar').toBe(
      false,
    )
  })

  it('test_NEGATIVE_an_API_KEY_method_is_refused_by_the_device_facade', async () => {
    // O compilador já barra pelo lado tipado (união discriminada); esta é a guarda para quem chega
    // por JS sem tipos. Um método `type:'api'` não tem `authorize` — chamar o Facade com ele deve
    // falhar CLARO, não com `authorize is not a function`.
    const credKey = { label: 'Manually enter API Key', type: 'api' as const }
    const provider: DeviceAuthProvider = {
      name: 's',
      oauth: CODEX_PROVIDER.oauth,
      methods: [credKey],
    }
    await expect(
      loginWithDevice(provider, credKey as unknown as AuthMethod, store(), { onPrompt: () => {} }),
    ).rejects.toThrow(/credKey|api key|não é um método de device|not a device method/i)
  })

  it('test_NEGATIVE_a_provider_with_NO_methods_fails_clearly_instead_of_returning_an_empty_list', async () => {
    // Um provider sem métodos renderiza uma escolha em branco, que o usuário lê como travamento.
    const empty: DeviceAuthProvider = { name: 'vazio', oauth: CODEX_PROVIDER.oauth, methods: [] }
    const anything: AuthMethod = {
      label: 'x',
      type: 'oauth',
      authorize: async () => ({ access: 'A', refresh: 'R', expires: 1 }),
    }
    await expect(loginWithDevice(empty, anything, store(), { onPrompt: () => {} })).rejects.toThrow(
      /nenhum método|no methods/i,
    )
  })

  it('test_NEGATIVE_an_authorize_failure_propagates_and_nothing_is_written', async () => {
    // Falhar DEPOIS de gravar deixaria credencial parcial no disco, e a próxima execução leria um
    // estado que nunca foi válido.
    const broken: AuthMethod = {
      label: 'quebrado',
      type: 'oauth',
      authorize: () => Promise.reject(new Error('device endpoint returned HTTP 401')),
    }
    const provider: DeviceAuthProvider = {
      name: 's',
      oauth: CODEX_PROVIDER.oauth,
      methods: [broken],
    }
    await expect(
      loginWithDevice(provider, broken, store(), { onPrompt: () => {} }),
    ).rejects.toThrow(/401/)
    expect(existsSync(join(home, '.m111', 'auth.json')), 'gravou credencial apesar do erro').toBe(
      false,
    )
  })

  it('test_the_environment_clientId_override_WORKS_and_only_at_load', async () => {
    // MEDIUM-4 do review: `CODEX_CLIENT_ID_ENV_VAR` era API pública exportada, documentada em cinco
    // linhas, com ZERO teste — remover o `process.env[…] ??` mantinha tudo verde. Um knob sem oráculo
    // é indistinguível de um knob que não funciona.
    //
    // A leitura acontece na avaliação do MÓDULO, então `vi.resetModules()` é o que torna o teste
    // possível — e essa é exatamente a limitação que o consumidor precisa conhecer: definir a variável
    // depois do import não tem efeito nenhum.
    const { CODEX_CLIENT_ID_ENV_VAR } = await import('../../src/auth-entry.js')
    const anterior = process.env[CODEX_CLIENT_ID_ENV_VAR]
    process.env[CODEX_CLIENT_ID_ENV_VAR] = 'app_DE_OUTRO_TENANT'
    try {
      vi.resetModules()
      const reloaded = (await import('../../src/auth/device-provider.js')) as {
        CODEX_PROVIDER: { oauth: { clientId: string } }
      }
      expect(
        reloaded.CODEX_PROVIDER.oauth.clientId,
        'o override por ambiente não teve efeito — o knob é decorativo',
      ).toBe('app_DE_OUTRO_TENANT')
    } finally {
      // `vi.stubEnv`/restauração por atribuição em vez de `delete` com chave computada: a regra do
      // monorepo proíbe o `delete` dinâmico, e a string vazia é indistinguível de ausente para o
      // `??` que lê o knob.
      process.env[CODEX_CLIENT_ID_ENV_VAR] = anterior ?? ''
      vi.resetModules()
    }
  })
})
