import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { McpFileError, loadMcpJson } from '../../src/bridge/mcp-file.js'

/**
 * M112 — o `.mcp.json` degrada por ENTRADA, e o transporte remoto atravessa.
 *
 * ## Os dois defeitos que este arquivo fecha
 *
 * **(A) O escopo `stdio only` tinha critério de saída escrito e vencido.** O docblock deste módulo
 * dizia: *"os transportes remotos (HTTP/SSE) estão deliberadamente fora … **alargar depois é
 * aditivo**"*, e a razão era ser substituta **exata** dos carregadores escritos à mão que ela
 * substituiu. Essa migração terminou no M107.
 *
 * **(B) Uma entrada não suportada matava o mapa inteiro.** Medido antes do M112, com arquivo
 * sintético: um servidor stdio perfeitamente válido + um `type: 'http'` produzia `McpFileError`, e o
 * stdio era perdido junto. Fail-closed no **raio errado** — recusar *uma entrada* é correto; recusar
 * *o arquivo* transforma "esse servidor não é suportado" em "você não tem MCP nenhum".
 *
 * ## A descoberta que encolheu o milestone
 *
 * O plano ia adicionar `@modelcontextprotocol/sdk` e construir transporte. O edge-case review mediu
 * que o **SDK já entrega tudo**:
 *
 * ```ts
 * type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig
 * type McpHttpServerConfig = {
 *   type?: 'http' | 'sse'; url: string
 *   headers?: Record<string,string>          // "Passed through. `Authorization` works here."
 *   auth?: McpAuthConfig                     // OAuth 2.1 PKCE completo
 *   requestTimeoutMs?: number                // AbortSignal.timeout, erro tipado, default 30_000
 * }
 * ```
 *
 * É **campo a campo** o que o blueprint derivou independentemente de `gemini-cli`, `opencode` e
 * `codex`. O M112 portanto **não constrói transporte** — ele para de estreitar: este módulo declarava
 * um `McpServerConfig` próprio, mais estreito que o do SDK, e recusava o que o SDK aceita.
 *
 * ## Por que os peers decidem assim
 *
 * Os dois peers TS contêm a falha **por servidor**, por idiomas diferentes: o `gemini-cli` usa
 * `Promise.all` sobre promises que **nunca rejeitam** (`connectAndDiscover` fecha o cliente, emite
 * diagnóstico nomeando o servidor, marca `DISCONNECTED` e não relança); o `opencode` devolve
 * `Effect.succeed({ status: 'failed' })`. **Nenhum** deixa um servidor derrubar os outros.
 *
 * ## A tensão com `error-handling.md § 2`, dita por extenso
 *
 * Aquela regra proíbe engolir erro. Isto **não é engolir** — é falhar no raio certo. O erro continua
 * tipado, continua nomeando a entrada, e continua visível pelo canal de aviso. O que muda é o raio:
 * era o arquivo, passa a ser a entrada. Um arquivo **impartível** (JSON quebrado, `mcpServers` que não
 * é objeto) continua lançando, porque ali não há entradas para separar.
 */
describe('M112 — .mcp.json degrades per entry', () => {
  let dir: string
  let warnings: string[]

  const writeIt = (doc: unknown): void => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify(doc))
  }
  const load = () => loadMcpJson(dir, { onWarn: (m: string) => warnings.push(m) })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'm112-'))
    warnings = []
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('test_floor_the_stdio_happy_path_stays_intact', () => {
    // PISO ANTI-VACUIDADE: sem ele, "a entrada boa sobreviveu" seria satisfeito por um parser que
    // devolve tudo sem validar nada. O caminho que já funcionava tem de continuar funcionando.
    writeIt({ mcpServers: { local: { command: 'echo', args: ['ok'], cwd: '/tmp' } } })
    const map = load()
    expect(Object.keys(map)).toEqual(['local'])
    expect(map.local).toEqual({ command: 'echo', args: ['ok'], cwd: '/tmp' })
    expect(warnings, 'o caminho feliz não deve avisar nada').toEqual([])
  })

  it('test_an_INVALID_entry_does_not_kill_the_valid_ones', () => {
    // O DEFEITO B. Antes do M112 isto lançava `McpFileError` e perdia as duas.
    writeIt({
      mcpServers: {
        'stdio-que-funciona': { command: 'echo', args: ['ok'] },
        'sem-command-nem-url': { args: ['x'] },
      },
    })
    const map = load()
    expect(
      Object.keys(map),
      'a entrada boa foi perdida junto com a ruim — é o fail-closed no raio errado',
    ).toEqual(['stdio-que-funciona'])
  })

  it('test_the_omitted_entry_is_NAMED_in_the_warning', () => {
    // Sem esta asserção, "não lançar" escorrega para "ignorar em silêncio", que é o fail-OPEN — o
    // risco R-2 do plano. O aviso é o que mantém o erro visível depois de estreitar o raio.
    writeIt({
      mcpServers: { bom: { command: 'echo' }, 'ruim-sem-nada': { args: ['x'] } },
    })
    load()
    expect(warnings, 'a omissão foi silenciosa').toHaveLength(1)
    expect(warnings.join(' '), 'o aviso não nomeia a entrada omitida').toContain('ruim-sem-nada')
  })

  it('test_the_HTTP_transport_crosses_INTACT', () => {
    // O DEFEITO A. A forma é a do SDK (`McpHttpServerConfig`), não uma inventada aqui — o M112 para
    // de estreitar em vez de construir.
    const serverEntry = {
      type: 'http' as const,
      url: 'https://exemplo.invalido/mcp',
      headers: { Authorization: 'Bearer SENTINELA-M112' },
      requestTimeoutMs: 5_000,
    }
    writeIt({ mcpServers: { remoto: serverEntry } })
    const map = load()
    expect(
      map.remoto,
      'a entrada HTTP não atravessou intacta — a camada continua estreitando o que o SDK aceita',
    ).toEqual(serverEntry)
    expect(warnings).toEqual([])
  })

  it('test_a_url_without_type_crosses_and_the_SDK_decides_the_default', () => {
    // O `gemini-cli` faz `url` sem `type` cair em HTTP. A camada NÃO decide isso — ela repassa, e o
    // default é do SDK. Inventar o default aqui seria um segundo oráculo sobre o mesmo fato.
    writeIt({ mcpServers: { r: { url: 'https://exemplo.invalido/mcp' } } })
    expect(load().r).toEqual({ url: 'https://exemplo.invalido/mcp' })
  })

  it('test_type_sse_also_crosses', () => {
    writeIt({ mcpServers: { r: { type: 'sse', url: 'https://exemplo.invalido/sse' } } })
    expect(load().r).toEqual({ type: 'sse', url: 'https://exemplo.invalido/sse' })
  })

  it('test_stdio_and_remote_COEXIST_in_the_same_file', () => {
    // A forma exata do `.mcp.json` real que motivou o milestone: um stdio e um HTTP lado a lado.
    writeIt({
      mcpServers: {
        'add-fixture': { command: 'npx', args: ['fixture'] },
        'theo-skills': {
          type: 'http',
          url: 'https://exemplo.invalido/mcp',
          headers: { Authorization: 'Bearer X' },
        },
      },
    })
    const map = load()
    expect([...Object.keys(map)].sort((a, b) => a.localeCompare(b))).toEqual([
      'add-fixture',
      'theo-skills',
    ])
    expect(warnings, 'o arquivo do caso real não deve produzir aviso nenhum').toEqual([])
  })

  it('test_NEGATIVE_an_unknown_type_is_omitted_and_named', () => {
    writeIt({
      mcpServers: {
        bom: { command: 'echo' },
        exotico: { type: 'carrier-pigeon', url: 'https://x.invalido' },
      },
    })
    const map = load()
    expect(Object.keys(map)).toEqual(['bom'])
    expect(warnings.join(' ')).toContain('exotico')
  })

  it('test_NEGATIVE_url_and_command_together_are_omitted_and_named', () => {
    // Config ambígua não é adivinhada — o SDK tem uma união discriminada, e uma entrada que satisfaz
    // os dois ramos não é nem um nem outro.
    writeIt({
      mcpServers: {
        bom: { command: 'echo' },
        ambiguo: { command: 'echo', url: 'https://x.invalido' },
      },
    })
    expect(Object.keys(load())).toEqual(['bom'])
    expect(warnings.join(' ')).toContain('ambiguo')
  })

  it('test_NEGATIVE_a_url_that_is_not_a_url_is_omitted_and_named', () => {
    writeIt({ mcpServers: { bom: { command: 'echo' }, r: { type: 'http', url: 'não-é-url' } } })
    expect(Object.keys(load())).toEqual(['bom'])
    expect(warnings.join(' ')).toContain('r')
  })

  it('test_NEGATIVE_the_header_value_NEVER_appears_in_the_warning', () => {
    // D5 do plano. Os peers DIVERGEM aqui — `gemini-cli` redige em 18 sítios, `opencode` em ZERO —, e
    // um peer não é precedente para segurança. Decide o precedente INTERNO: `AuthProvider` declara que
    // nunca expõe material de token. O `.mcp.json` é arquivo de PROJETO, que pode ser commitado.
    writeIt({
      mcpServers: {
        vazador: {
          type: 'http',
          url: 'https://ok.invalido/mcp',
          headers: { Authorization: 12345 },
        },
      },
    })
    load()
    // A URL é VÁLIDA de propósito. A primeira versão usava `url: 'não-é-url'`, e `validarRemoto`
    // retorna no primeiro erro — o aviso era sobre a URL e **nunca tocava `headers`**. O review provou
    // por mutação: trocar a mensagem do ramo de headers por uma que despeja o valor mantinha os 28
    // testes verdes. Um controle que nunca alcança o ramo que protegeria é indistinguível de nenhum
    // controle (`mecanismo-anti-esquecimento.md § 5.3`).
    expect(
      warnings,
      'o ramo de headers não disparou — o teste voltou a não alcançá-lo',
    ).toHaveLength(1)
    expect(warnings.join(' '), 'o aviso deve nomear a entrada').toContain('vazador')
    expect(warnings.join(' '), 'o aviso deve falar da FORMA do campo').toContain('headers')
    expect(warnings.join(' '), 'o aviso vazou o conteúdo do header').not.toContain('12345')

    // O caso anterior segue coberto, como cenário SEPARADO: URL inválida com header presente.
    warnings.length = 0
    writeIt({
      mcpServers: {
        outro: {
          type: 'http',
          url: 'não-é-url',
          headers: { Authorization: 'Bearer SEGREDO-XYZ-123' },
        },
      },
    })
    load()
    expect(warnings.join(' '), 'o aviso vazou o valor do header').not.toContain('SEGREDO-XYZ-123')
  })

  it('test_NEGATIVE_an_unparseable_file_STILL_throws', () => {
    // O que separa "raio certo" de fail-open: sem entradas para separar, não há degradação possível.
    writeFileSync(join(dir, '.mcp.json'), '{ isto não é json')
    expect(() => load()).toThrow(McpFileError)
  })

  it('test_NEGATIVE_an_mcpServers_that_is_not_an_object_STILL_throws', () => {
    writeIt({ mcpServers: ['isto', 'é', 'um', 'array'] })
    expect(() => load()).toThrow(McpFileError)
  })

  it('test_a_missing_file_returns_empty_with_NO_error', () => {
    // MCP é opt-in — a ausência do arquivo nunca foi erro, e continua não sendo.
    expect(loadMcpJson(join(dir, 'nao-existe'))).toEqual({})
  })

  it('test_omitting_onWarn_falls_back_to_stderr_NEVER_to_silence', () => {
    // HIGH-1 do review: `onWarn` opcional deixava a omissão SILENCIOSA quando o chamador não assinava
    // — e o único chamador de produção não assinava. Toda a defesa contra `error-handling.md § 2`
    // dependia da frase "o erro segue visível pelo canal"; sem assinante, não seguia.
    const original = process.stderr.write.bind(process.stderr)
    const captured: string[] = []
    process.stderr.write = ((s: string) => {
      captured.push(s)
      return true
    }) as typeof process.stderr.write
    try {
      writeIt({ mcpServers: { bom: { command: 'echo' }, ruim: {} } })
      expect(Object.keys(loadMcpJson(dir))).toEqual(['bom'])
    } finally {
      process.stderr.write = original
    }
    expect(captured.join(' '), 'a omissão foi silenciosa sem `onWarn` — é fail-open').toContain(
      'ruim',
    )
  })

  it('test_SECURITY_the_files_envPolicy_does_NOT_cross', () => {
    // BLOCKER-1 do review. `envPolicy: 'all'` desliga o scrub que impede um binário de terceiro de
    // exfiltrar segredos do host via ambiente — e o `.mcp.json` é arquivo de PROJETO. A primeira
    // versão do M112 repassava o objeto cru e deixava esse campo atravessar.
    writeIt({ mcpServers: { s: { command: 'node', args: ['x.js'], envPolicy: 'all' } } })
    const serverEntry = load().s as unknown as Record<string, unknown>
    expect(
      'envPolicy' in serverEntry,
      'o `.mcp.json` conseguiu desligar o scrub de segredos do host — um repositório passa a poder ' +
        'entregar ANTHROPIC_API_KEY e NPM_TOKEN a um binário de terceiro com uma linha de JSON',
    ).toBe(false)
    expect(serverEntry, 'o resto da entrada stdio deve atravessar normalmente').toEqual({
      command: 'node',
      args: ['x.js'],
    })
  })

  it('test_SECURITY_an_unknown_field_does_NOT_cross', () => {
    // A allowlist é a REGRA, não uma lista de proibidos: um campo que ninguém previu também não passa.
    // Sem isto, o próximo campo perigoso do SDK atravessaria sozinho no dia em que fosse criado.
    writeIt({
      mcpServers: {
        s: { command: 'node', campoInventado: { x: 1 } },
        r: { type: 'http', url: 'https://ok.invalido/mcp', outroInventado: 'y' },
      },
    })
    const m = load()
    expect(m.s).toEqual({ command: 'node' })
    expect(m.r).toEqual({ type: 'http', url: 'https://ok.invalido/mcp' })
  })
})
