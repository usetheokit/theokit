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
describe('M112 — o .mcp.json degrada por entrada', () => {
  let dir: string
  let avisos: string[]

  const escrever = (doc: unknown): void => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify(doc))
  }
  const carregar = () => loadMcpJson(dir, { onWarn: (m: string) => avisos.push(m) })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'm112-'))
    avisos = []
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('test_piso_o_caminho_feliz_stdio_continua_intacto', () => {
    // PISO ANTI-VACUIDADE: sem ele, "a entrada boa sobreviveu" seria satisfeito por um parser que
    // devolve tudo sem validar nada. O caminho que já funcionava tem de continuar funcionando.
    escrever({ mcpServers: { local: { command: 'echo', args: ['ok'], cwd: '/tmp' } } })
    const mapa = carregar()
    expect(Object.keys(mapa)).toEqual(['local'])
    expect(mapa.local).toEqual({ command: 'echo', args: ['ok'], cwd: '/tmp' })
    expect(avisos, 'o caminho feliz não deve avisar nada').toEqual([])
  })

  it('test_uma_entrada_INVALIDA_nao_mata_as_validas', () => {
    // O DEFEITO B. Antes do M112 isto lançava `McpFileError` e perdia as duas.
    escrever({
      mcpServers: {
        'stdio-que-funciona': { command: 'echo', args: ['ok'] },
        'sem-command-nem-url': { args: ['x'] },
      },
    })
    const mapa = carregar()
    expect(
      Object.keys(mapa),
      'a entrada boa foi perdida junto com a ruim — é o fail-closed no raio errado',
    ).toEqual(['stdio-que-funciona'])
  })

  it('test_a_entrada_omitida_e_NOMEADA_no_aviso', () => {
    // Sem esta asserção, "não lançar" escorrega para "ignorar em silêncio", que é o fail-OPEN — o
    // risco R-2 do plano. O aviso é o que mantém o erro visível depois de estreitar o raio.
    escrever({
      mcpServers: { bom: { command: 'echo' }, 'ruim-sem-nada': { args: ['x'] } },
    })
    carregar()
    expect(avisos, 'a omissão foi silenciosa').toHaveLength(1)
    expect(avisos.join(' '), 'o aviso não nomeia a entrada omitida').toContain('ruim-sem-nada')
  })

  it('test_o_transporte_HTTP_atravessa_INTACTO', () => {
    // O DEFEITO A. A forma é a do SDK (`McpHttpServerConfig`), não uma inventada aqui — o M112 para
    // de estreitar em vez de construir.
    const entrada = {
      type: 'http' as const,
      url: 'https://exemplo.invalido/mcp',
      headers: { Authorization: 'Bearer SENTINELA-M112' },
      requestTimeoutMs: 5_000,
    }
    escrever({ mcpServers: { remoto: entrada } })
    const mapa = carregar()
    expect(
      mapa.remoto,
      'a entrada HTTP não atravessou intacta — a camada continua estreitando o que o SDK aceita',
    ).toEqual(entrada)
    expect(avisos).toEqual([])
  })

  it('test_url_sem_type_atravessa_e_o_SDK_decide_o_default', () => {
    // O `gemini-cli` faz `url` sem `type` cair em HTTP. A camada NÃO decide isso — ela repassa, e o
    // default é do SDK. Inventar o default aqui seria um segundo oráculo sobre o mesmo fato.
    escrever({ mcpServers: { r: { url: 'https://exemplo.invalido/mcp' } } })
    expect(carregar().r).toEqual({ url: 'https://exemplo.invalido/mcp' })
  })

  it('test_type_sse_tambem_atravessa', () => {
    escrever({ mcpServers: { r: { type: 'sse', url: 'https://exemplo.invalido/sse' } } })
    expect(carregar().r).toEqual({ type: 'sse', url: 'https://exemplo.invalido/sse' })
  })

  it('test_o_stdio_e_o_remoto_COEXISTEM_no_mesmo_arquivo', () => {
    // A forma exata do `.mcp.json` real que motivou o milestone: um stdio e um HTTP lado a lado.
    escrever({
      mcpServers: {
        'add-fixture': { command: 'npx', args: ['fixture'] },
        'theo-skills': {
          type: 'http',
          url: 'https://exemplo.invalido/mcp',
          headers: { Authorization: 'Bearer X' },
        },
      },
    })
    const mapa = carregar()
    expect([...Object.keys(mapa)].sort((a, b) => a.localeCompare(b))).toEqual([
      'add-fixture',
      'theo-skills',
    ])
    expect(avisos, 'o arquivo do caso real não deve produzir aviso nenhum').toEqual([])
  })

  it('test_NEGATIVO_type_desconhecido_e_omitido_e_nomeado', () => {
    escrever({
      mcpServers: {
        bom: { command: 'echo' },
        exotico: { type: 'carrier-pigeon', url: 'https://x.invalido' },
      },
    })
    const mapa = carregar()
    expect(Object.keys(mapa)).toEqual(['bom'])
    expect(avisos.join(' ')).toContain('exotico')
  })

  it('test_NEGATIVO_url_e_command_juntos_e_omitido_e_nomeado', () => {
    // Config ambígua não é adivinhada — o SDK tem uma união discriminada, e uma entrada que satisfaz
    // os dois ramos não é nem um nem outro.
    escrever({
      mcpServers: {
        bom: { command: 'echo' },
        ambiguo: { command: 'echo', url: 'https://x.invalido' },
      },
    })
    expect(Object.keys(carregar())).toEqual(['bom'])
    expect(avisos.join(' ')).toContain('ambiguo')
  })

  it('test_NEGATIVO_url_que_nao_e_url_e_omitida_e_nomeada', () => {
    escrever({ mcpServers: { bom: { command: 'echo' }, r: { type: 'http', url: 'não-é-url' } } })
    expect(Object.keys(carregar())).toEqual(['bom'])
    expect(avisos.join(' ')).toContain('r')
  })

  it('test_NEGATIVO_o_valor_do_header_NUNCA_aparece_no_aviso', () => {
    // D5 do plano. Os peers DIVERGEM aqui — `gemini-cli` redige em 18 sítios, `opencode` em ZERO —, e
    // um peer não é precedente para segurança. Decide o precedente INTERNO: `AuthProvider` declara que
    // nunca expõe material de token. O `.mcp.json` é arquivo de PROJETO, que pode ser commitado.
    escrever({
      mcpServers: {
        vazador: {
          type: 'http',
          url: 'https://ok.invalido/mcp',
          headers: { Authorization: 12345 },
        },
      },
    })
    carregar()
    // A URL é VÁLIDA de propósito. A primeira versão usava `url: 'não-é-url'`, e `validarRemoto`
    // retorna no primeiro erro — o aviso era sobre a URL e **nunca tocava `headers`**. O review provou
    // por mutação: trocar a mensagem do ramo de headers por uma que despeja o valor mantinha os 28
    // testes verdes. Um controle que nunca alcança o ramo que protegeria é indistinguível de nenhum
    // controle (`mecanismo-anti-esquecimento.md § 5.3`).
    expect(avisos, 'o ramo de headers não disparou — o teste voltou a não alcançá-lo').toHaveLength(
      1,
    )
    expect(avisos.join(' '), 'o aviso deve nomear a entrada').toContain('vazador')
    expect(avisos.join(' '), 'o aviso deve falar da FORMA do campo').toContain('headers')
    expect(avisos.join(' '), 'o aviso vazou o conteúdo do header').not.toContain('12345')

    // O caso anterior segue coberto, como cenário SEPARADO: URL inválida com header presente.
    avisos.length = 0
    escrever({
      mcpServers: {
        outro: {
          type: 'http',
          url: 'não-é-url',
          headers: { Authorization: 'Bearer SEGREDO-XYZ-123' },
        },
      },
    })
    carregar()
    expect(avisos.join(' '), 'o aviso vazou o valor do header').not.toContain('SEGREDO-XYZ-123')
  })

  it('test_NEGATIVO_arquivo_impartivel_CONTINUA_lancando', () => {
    // O que separa "raio certo" de fail-open: sem entradas para separar, não há degradação possível.
    writeFileSync(join(dir, '.mcp.json'), '{ isto não é json')
    expect(() => carregar()).toThrow(McpFileError)
  })

  it('test_NEGATIVO_mcpServers_que_nao_e_objeto_CONTINUA_lancando', () => {
    escrever({ mcpServers: ['isto', 'é', 'um', 'array'] })
    expect(() => carregar()).toThrow(McpFileError)
  })

  it('test_arquivo_ausente_devolve_vazio_SEM_erro', () => {
    // MCP é opt-in — a ausência do arquivo nunca foi erro, e continua não sendo.
    expect(loadMcpJson(join(dir, 'nao-existe'))).toEqual({})
  })

  it('test_onWarn_omitido_cai_em_stderr_NUNCA_em_silencio', () => {
    // HIGH-1 do review: `onWarn` opcional deixava a omissão SILENCIOSA quando o chamador não assinava
    // — e o único chamador de produção não assinava. Toda a defesa contra `error-handling.md § 2`
    // dependia da frase "o erro segue visível pelo canal"; sem assinante, não seguia.
    const original = process.stderr.write.bind(process.stderr)
    const capturado: string[] = []
    process.stderr.write = ((s: string) => {
      capturado.push(s)
      return true
    }) as typeof process.stderr.write
    try {
      escrever({ mcpServers: { bom: { command: 'echo' }, ruim: {} } })
      expect(Object.keys(loadMcpJson(dir))).toEqual(['bom'])
    } finally {
      process.stderr.write = original
    }
    expect(capturado.join(' '), 'a omissão foi silenciosa sem `onWarn` — é fail-open').toContain(
      'ruim',
    )
  })

  it('test_SEGURANCA_envPolicy_do_arquivo_NAO_atravessa', () => {
    // BLOCKER-1 do review. `envPolicy: 'all'` desliga o scrub que impede um binário de terceiro de
    // exfiltrar segredos do host via ambiente — e o `.mcp.json` é arquivo de PROJETO. A primeira
    // versão do M112 repassava o objeto cru e deixava esse campo atravessar.
    escrever({ mcpServers: { s: { command: 'node', args: ['x.js'], envPolicy: 'all' } } })
    const entrada = carregar().s as unknown as Record<string, unknown>
    expect(
      'envPolicy' in entrada,
      'o `.mcp.json` conseguiu desligar o scrub de segredos do host — um repositório passa a poder ' +
        'entregar ANTHROPIC_API_KEY e NPM_TOKEN a um binário de terceiro com uma linha de JSON',
    ).toBe(false)
    expect(entrada, 'o resto da entrada stdio deve atravessar normalmente').toEqual({
      command: 'node',
      args: ['x.js'],
    })
  })

  it('test_SEGURANCA_campo_desconhecido_NAO_atravessa', () => {
    // A allowlist é a REGRA, não uma lista de proibidos: um campo que ninguém previu também não passa.
    // Sem isto, o próximo campo perigoso do SDK atravessaria sozinho no dia em que fosse criado.
    escrever({
      mcpServers: {
        s: { command: 'node', campoInventado: { x: 1 } },
        r: { type: 'http', url: 'https://ok.invalido/mcp', outroInventado: 'y' },
      },
    })
    const m = carregar()
    expect(m.s).toEqual({ command: 'node' })
    expect(m.r).toEqual({ type: 'http', url: 'https://ok.invalido/mcp' })
  })
})
