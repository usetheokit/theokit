/**
 * M107 T2.1 — `loadMcpJson`: the layer reads the `.mcp.json` project convention.
 *
 * The layer already shipped the RARE cases (a per-request resolver, a registry builder) and not the
 * COMMON one: reading `<cwd>/.mcp.json`, the Claude Code / Cursor convention. Every consumer that
 * wanted it wrote the loader by hand — 121 LOC of production + 125 of test in the agent-builder.
 *
 * This suite is the equivalence oracle for that deletion (plan D4): the semantics here are the
 * semantics of the loader being deleted, case for case — absent file ⇒ `{}` (MCP is opt-in), typed
 * error on invalid JSON or a shape violation, and **stdio only**. Widening to HTTP/SSE now would
 * make the primitive stop being an exact substitute, which is the only cheap proof of equivalence
 * the milestone has.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type * as NodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TheokitAgentError } from '@theokit/sdk/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadMcpJson, McpFileError } from '../../src/bridge/mcp-file.js'
import { loadMcpJson as loadMcpJsonDaRaiz } from '../../src/index.js'

describe('loadMcpJson — disco', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'm107-mcp-file-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const escrever = (conteudo: string): void => {
    writeFileSync(join(dir, '.mcp.json'), conteudo)
  }

  it('test_arquivo_ausente_devolve_mapa_vazio', () => {
    // MCP é opt-in: a AUSÊNCIA do arquivo não é erro. É o único caminho que devolve `{}` sem ler.
    expect(loadMcpJson(dir)).toEqual({})
  })

  it('test_arquivo_valido_devolve_o_mapa_parseado', () => {
    escrever(
      JSON.stringify({
        mcpServers: {
          echo: { command: 'node', args: ['s.mjs'], env: { TOKEN: 'x' }, cwd: '/w' },
          min: { command: 'npx' },
        },
      }),
    )
    expect(loadMcpJson(dir)).toEqual({
      echo: { command: 'node', args: ['s.mjs'], env: { TOKEN: 'x' }, cwd: '/w' },
      min: { command: 'npx' },
    })
  })

  it('test_json_invalido_lanca_erro_tipado_citando_o_caminho', () => {
    escrever('{ not json')
    expect(() => loadMcpJson(dir)).toThrow(McpFileError)
    // O caminho na mensagem é o que torna o erro diagnosticável sem debugger (error-handling.md § 2).
    expect(() => loadMcpJson(dir)).toThrow(join(dir, '.mcp.json'))
  })

  it('test_arquivo_vazio_e_json_invalido_nao_mapa_vazio', () => {
    // Edge case deliberado: "ausente" e "presente e vazio" NÃO são a mesma coisa. O segundo é um
    // arquivo que alguém escreveu errado, e engoli-lo como `{}` desliga MCP em silêncio.
    escrever('')
    expect(() => loadMcpJson(dir)).toThrow(McpFileError)
  })

  it('test_caminho_que_e_diretorio_propaga_erro_tipado', () => {
    // Caso negativo: um DIRETÓRIO chamado `.mcp.json` existe, logo não cai no ramo "ausente"; a
    // falha de leitura (EISDIR) tem de subir TIPADA, nunca ser confundida com "sem MCP".
    mkdirSync(join(dir, '.mcp.json'))
    expect(() => loadMcpJson(dir)).toThrow(McpFileError)
  })

  it('test_raiz_sem_a_chave_de_servidores_devolve_mapa_vazio', () => {
    // Equivalência com o carregador que este símbolo apaga (`mcp-config.test.ts:37-39`): um objeto
    // JSON válido SEM a chave é um projeto sem MCP declarado, não um arquivo malformado.
    escrever(JSON.stringify({}))
    expect(loadMcpJson(dir)).toEqual({})
  })

  it('test_raiz_que_nao_e_objeto_lanca_erro_tipado', () => {
    escrever(JSON.stringify([]))
    expect(() => loadMcpJson(dir)).toThrow(/root must be a JSON object/)
    escrever(JSON.stringify('nope'))
    expect(() => loadMcpJson(dir)).toThrow(McpFileError)
  })

  // ─── M112: MUDANÇA DELIBERADA DE CONTRATO ────────────────────────────────────────────────────
  //
  // Os três testes abaixo codificavam o contrato antigo: qualquer defeito de UMA entrada lançava e
  // derrubava o arquivo inteiro. Medido, isso significava que um `.mcp.json` com um servidor stdio
  // perfeito e um vizinho inválido perdia OS DOIS — fail-closed no raio errado.
  //
  // O contrato novo separa os dois raios, e os testes foram reescritos para afirmar essa separação
  // em vez de serem apagados: o registro do que mudou vale mais que a ausência do teste antigo.
  //
  //   defeito de ENTRADA  → omitida, NOMEADA no aviso, vizinhas sobem
  //   defeito de ARQUIVO  → continua lançando (não há entradas para separar)
  //
  // A cobertura da forma nova vive em `mcp-file-remoto.test.ts`.

  it('test_M112_servidor_sem_comando_e_OMITIDO_e_nomeado_em_vez_de_derrubar_o_arquivo', () => {
    const avisos: string[] = []
    escrever(JSON.stringify({ mcpServers: { bom: { command: 'echo' }, a: { args: ['x'] } } }))
    const mapa = loadMcpJson(dir, { onWarn: (m) => avisos.push(m) })
    expect(Object.keys(mapa), 'a entrada boa foi perdida junto com a ruim').toEqual(['bom'])
    expect(avisos.join(' '), 'a omissão foi silenciosa — isso seria fail-OPEN').toContain('"a"')
  })

  it('test_M112_args_env_cwd_com_tipo_errado_OMITEM_a_entrada_e_nomeiam', () => {
    for (const ruim of [
      { command: 'c', args: [1] },
      { command: 'c', env: { K: 2 } },
      { command: 'c', cwd: 3 },
    ]) {
      const avisos: string[] = []
      escrever(JSON.stringify({ mcpServers: { bom: { command: 'echo' }, a: ruim } }))
      expect(Object.keys(loadMcpJson(dir, { onWarn: (m) => avisos.push(m) }))).toEqual(['bom'])
      expect(avisos.join(' ')).toContain('"a"')
    }
  })

  it('test_M112_o_defeito_de_ARQUIVO_continua_lancando_o_de_ENTRADA_nao', () => {
    // A metade que NÃO mudou, e que é o que separa "raio certo" de fail-open.
    escrever(JSON.stringify({ mcpServers: [] }))
    expect(() => loadMcpJson(dir)).toThrow(/must be an object keyed by server name/)

    // …e a metade que mudou: `a: 5` é uma ENTRADA malformada, não um arquivo malformado.
    const avisos: string[] = []
    escrever(JSON.stringify({ mcpServers: { bom: { command: 'echo' }, a: 5 } }))
    expect(Object.keys(loadMcpJson(dir, { onWarn: (m) => avisos.push(m) }))).toEqual(['bom'])
    expect(avisos.join(' ')).toContain('"a"')
  })

  it('test_o_erro_desce_da_hierarquia_da_camada', () => {
    // A razão de o erro NÃO estender `Error` nu: `isTransientError` exige `TheokitAgentError`, e
    // uma hierarquia paralela torna o predicado que separa recuperável de irrecuperável inútil.
    escrever('{ not json')
    let capturado: unknown
    try {
      loadMcpJson(dir)
    } catch (err) {
      capturado = err
    }
    expect(capturado).toBeInstanceOf(McpFileError)
    expect(capturado).toBeInstanceOf(TheokitAgentError)
    expect(capturado).toBeInstanceOf(Error)
    expect((capturado as McpFileError).isRetryable).toBe(false)
  })

  it('test_o_mesmo_simbolo_resolve_pela_raiz_do_barril', () => {
    expect(loadMcpJsonDaRaiz).toBe(loadMcpJson)
  })
})

describe('loadMcpJson — pureza de import', () => {
  afterEach(() => {
    vi.doUnmock('node:fs')
    vi.resetModules()
  })

  it('test_importar_o_modulo_nao_le_disco', async () => {
    // Ler o arquivo é opt-in e NUNCA acontece no import — o consumidor tem um teste de pureza de
    // import que afirma zero chamadas do carregador ao carregar o módulo de chat, e uma primitiva
    // com efeito colateral de módulo o quebraria a partir daqui.
    const real = await vi.importActual<typeof NodeFs>('node:fs')
    const readFileSync = vi.fn(real.readFileSync)
    const existsSync = vi.fn(real.existsSync)
    vi.doMock('node:fs', () => ({ ...real, default: real, readFileSync, existsSync }))
    vi.resetModules()

    await import('../../src/bridge/mcp-file.js')

    expect(readFileSync).not.toHaveBeenCalled()
    expect(existsSync).not.toHaveBeenCalled()
  })
})
