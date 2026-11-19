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

import {
  loadMcpJson,
  loadMcpServersFile,
  mcpSecretValues,
  McpFileError,
} from '../../src/bridge/mcp-file.js'
import * as bridge from '../../src/bridge/index.js'
import { loadMcpJson as loadMcpJsonFromBarrel } from '../../src/index.js'

describe('loadMcpJson — disco', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'm107-mcp-file-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const write = (contents: string): void => {
    writeFileSync(join(dir, '.mcp.json'), contents)
  }

  it('test_a_missing_file_returns_an_empty_map', () => {
    // MCP is opt-in: the ABSENCE of the file is not an error. It is the only path returning `{}`
    // without reading.
    expect(loadMcpJson(dir)).toEqual({})
  })

  it('test_a_valid_file_returns_the_parsed_map', () => {
    write(
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

  it('test_invalid_json_throws_a_typed_error_citing_the_path', () => {
    write('{ not json')
    expect(() => loadMcpJson(dir)).toThrow(McpFileError)
    // The path in the message is what makes the error diagnosable without a debugger
    // (error-handling.md § 2).
    expect(() => loadMcpJson(dir)).toThrow(join(dir, '.mcp.json'))
  })

  it('test_an_empty_file_is_invalid_json_not_an_empty_map', () => {
    // A deliberate edge case: "absent" and "present and empty" are NOT the same thing. The second is
    // a file somebody wrote wrong, and swallowing it as `{}` disables MCP in silence.
    write('')
    expect(() => loadMcpJson(dir)).toThrow(McpFileError)
  })

  it('test_a_path_that_is_a_directory_propagates_a_typed_error', () => {
    // Negative case: a DIRECTORY named `.mcp.json` exists, so it does not fall into the "absent"
    // branch; the read failure (EISDIR) has to propagate TYPED, never be confused with "no MCP".
    mkdirSync(join(dir, '.mcp.json'))
    expect(() => loadMcpJson(dir)).toThrow(McpFileError)
  })

  it('test_a_root_without_the_servers_key_returns_an_empty_map', () => {
    // Equivalence with the loader this symbol deletes (`mcp-config.test.ts:37-39`): a valid JSON
    // object WITHOUT the key is a project with no MCP declared, not a malformed file.
    write(JSON.stringify({}))
    expect(loadMcpJson(dir)).toEqual({})
  })

  it('test_a_root_that_is_not_an_object_throws_a_typed_error', () => {
    write(JSON.stringify([]))
    expect(() => loadMcpJson(dir)).toThrow(/root must be a JSON object/)
    write(JSON.stringify('nope'))
    expect(() => loadMcpJson(dir)).toThrow(McpFileError)
  })

  // ─── M112: A DELIBERATE CONTRACT CHANGE ──────────────────────────────────────────────────────
  //
  // The three tests below encoded the old contract: any defect in ONE entry threw and took down the
  // whole file. Measured, that meant a `.mcp.json` with a perfect stdio server and an invalid
  // neighbour lost BOTH — fail-closed at the wrong radius.
  //
  // The new contract separates the two radii, and the tests were rewritten to assert that separation
  // rather than deleted: the record of what changed is worth more than the absence of the old test.
  //
  //   an ENTRY-level defect  → omitted, NAMED in the warning, neighbours come through
  //   a FILE-level defect    → still throws (there are no entries to separate)
  //
  // Coverage of the new shape lives in `mcp-file-remote.test.ts`.

  it('test_M112_a_server_with_no_command_is_OMITTED_and_named_instead_of_killing_the_file', () => {
    const warnings: string[] = []
    write(JSON.stringify({ mcpServers: { good: { command: 'echo' }, a: { args: ['x'] } } }))
    const map = loadMcpJson(dir, { onWarn: (m) => warnings.push(m) })
    expect(Object.keys(map), 'the good entry was lost along with the bad one').toEqual(['good'])
    expect(warnings.join(' '), 'the omission was silent — that would be fail-OPEN').toContain('"a"')
  })

  it('test_M112_args_env_cwd_with_the_wrong_type_OMIT_the_entry_and_name_it', () => {
    for (const bad of [
      { command: 'c', args: [1] },
      { command: 'c', env: { K: 2 } },
      { command: 'c', cwd: 3 },
    ]) {
      const warnings: string[] = []
      write(JSON.stringify({ mcpServers: { good: { command: 'echo' }, a: bad } }))
      expect(Object.keys(loadMcpJson(dir, { onWarn: (m) => warnings.push(m) }))).toEqual(['good'])
      expect(warnings.join(' ')).toContain('"a"')
    }
  })

  it('test_M112_a_FILE_level_defect_still_throws_an_ENTRY_level_one_does_not', () => {
    // The half that did NOT change, and which is what separates "the right radius" from fail-open.
    write(JSON.stringify({ mcpServers: [] }))
    expect(() => loadMcpJson(dir)).toThrow(/must be an object keyed by server name/)

    // …and the half that did change: `a: 5` is a malformed ENTRY, not a malformed file.
    const warnings: string[] = []
    write(JSON.stringify({ mcpServers: { good: { command: 'echo' }, a: 5 } }))
    expect(Object.keys(loadMcpJson(dir, { onWarn: (m) => warnings.push(m) }))).toEqual(['good'])
    expect(warnings.join(' ')).toContain('"a"')
  })

  it('test_the_error_descends_from_the_layers_hierarchy', () => {
    // The reason the error does NOT extend a bare `Error`: `isTransientError` requires
    // `TheokitAgentError`, and a parallel hierarchy makes the predicate that separates recoverable
    // from unrecoverable useless.
    write('{ not json')
    let captured: unknown
    try {
      loadMcpJson(dir)
    } catch (err) {
      captured = err
    }
    expect(captured).toBeInstanceOf(McpFileError)
    expect(captured).toBeInstanceOf(TheokitAgentError)
    expect(captured).toBeInstanceOf(Error)
    expect((captured as McpFileError).isRetryable).toBe(false)
  })

  it('test_the_same_symbol_resolves_through_the_barrel_root', () => {
    expect(loadMcpJsonFromBarrel).toBe(loadMcpJson)
  })
})

describe('loadMcpJson — import purity', () => {
  afterEach(() => {
    vi.doUnmock('node:fs')
    vi.resetModules()
  })

  it('test_importing_the_module_does_not_read_disk', async () => {
    // Reading the file is opt-in and NEVER happens at import — the consumer has an import-purity test
    // asserting zero loader calls when the chat module is loaded, and a primitive with a module-level
    // side effect would break it from here.
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

describe('loadMcpServersFile', () => {
  it('is exported from the bridge entry point with mcpSecretValues', () => {
    expect(bridge.loadMcpServersFile).toBe(loadMcpServersFile)
    expect(bridge.mcpSecretValues).toBe(mcpSecretValues)
  })

  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-servers-file-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const load = (servers: unknown, policy?: Parameters<typeof loadMcpServersFile>[1]) => {
    const path = join(dir, 'servers.json')
    writeFileSync(path, JSON.stringify({ mcpServers: servers }))
    return loadMcpServersFile(path, { onWarn: () => undefined, ...policy })
  }

  it('loads a valid file and carries envPolicy and requestTimeoutMs', () => {
    const out = load({
      good: { command: '/usr/bin/x', envPolicy: 'core', requestTimeoutMs: 5000, cwd: '/tmp' },
    })
    expect(out.good).toMatchObject({
      command: '/usr/bin/x',
      envPolicy: 'core',
      requestTimeoutMs: 5000,
    })
  })

  it('a relative command with a slash is refused with McpFileError naming the JSON path', () => {
    expect(() => load({ bad: { command: './evil.sh' } })).toThrow(McpFileError)
    expect(() => load({ bad: { command: './evil.sh' } })).toThrow(/mcpServers\.bad\.command/)
  })

  it('a bare command name is accepted', () => {
    expect(load({ ok: { command: 'npx' } }).ok).toBeDefined()
  })

  it('a relative cwd is refused', () => {
    expect(() => load({ bad: { command: 'npx', cwd: 'rel' } })).toThrow(/mcpServers\.bad\.cwd/)
  })

  it('envPolicy all is refused by the default policy', () => {
    expect(() => load({ bad: { command: 'npx', envPolicy: 'all' } })).toThrow(/envPolicy/)
  })

  it('envPolicy all is allowed when the policy lists it', () => {
    const out = load(
      { s: { command: 'npx', envPolicy: 'all' } },
      { policy: { allowedEnvPolicies: ['all'] } },
    )
    expect(out.s).toBeDefined()
  })

  it('a timeout above 2147483647 is refused', () => {
    expect(() => load({ bad: { command: 'npx', requestTimeoutMs: 2_147_483_648 } })).toThrow(
      /requestTimeoutMs/,
    )
    expect(() => load({ bad: { command: 'npx', requestTimeoutMs: 0 } })).toThrow(McpFileError)
  })

  it('refuses a server name outside the SDK-safe pattern', () => {
    expect(() => load({ Bad_Name: { command: 'npx' } })).toThrow(McpFileError)
  })

  it('refuses unknown keys and http auth', () => {
    expect(() => load({ s: { command: 'npx', extra: 1 } })).toThrow(/mcpServers\.s\.extra/)
    expect(() => load({ s: { url: 'https://x.test/mcp', auth: {} } })).toThrow(/auth/)
  })

  it('an invalid JSON file error does not contain text from the file', () => {
    const path = join(dir, 'broken.json')
    writeFileSync(path, '{"mcpServers": SECRETTEXT-12345}')
    let message = ''
    try {
      loadMcpServersFile(path)
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain(path)
    expect(message).not.toContain('SECRETTEXT')
  })

  it('a missing file is an error', () => {
    expect(() => loadMcpServersFile(join(dir, 'nope.json'))).toThrow(McpFileError)
  })

  it('mcpSecretValues returns header and env values of 8 or more characters only', () => {
    const servers = load(
      {
        a: { command: 'npx', env: { K: 'short', L: 'long-enough-value' } },
        b: {
          url: 'https://x.test/mcp',
          headers: { Authorization: 'Bearer abcdefgh', X: '1234567' },
        },
      },
      { policy: {} },
    )
    expect([...mcpSecretValues(servers)].sort((a, b) => a.localeCompare(b))).toEqual(
      ['Bearer abcdefgh', 'long-enough-value'].sort((a, b) => a.localeCompare(b)),
    )
    expect(mcpSecretValues(servers, 5)).toContain('short')
  })

  it('throws on a shape violation instead of skipping the entry, naming the path', () => {
    expect(() => load({ s: { command: 5 } })).toThrow(/mcpServers\.s\.command: /)
    expect(() => load({ s: { url: 'https://x.test/mcp', headers: { A: 1 } } })).toThrow(
      /mcpServers\.s\.headers\.A: /,
    )
    expect(() => load({ s: { command: 'x', env: { K: 'v', L: 2 } } })).toThrow(
      /mcpServers\.s\.env\.L: /,
    )
    expect(() => load({ s: { command: 'x', args: ['a', 3] } })).toThrow(/mcpServers\.s\.args\.1: /)
  })

  it('a shape error names the path and never a value', () => {
    let message = ''
    try {
      load({ s: { url: 'https://x.test/mcp', headers: { A: 'SECRETVALUE', B: 1 } } })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('mcpServers.s.headers.B')
    expect(message).not.toContain('SECRETVALUE')
  })

  it('requireAbsoluteCommandPaths false accepts a relative command; cwd stays enforced', () => {
    const policy = { requireAbsoluteCommandPaths: false }
    expect(load({ s: { command: './x.sh' } }, { policy }).s).toBeDefined()
    expect(() => load({ s: { command: './x.sh', cwd: 'rel' } }, { policy })).toThrow(/\.cwd/)
  })

  it('requireAbsoluteCwd false accepts a relative cwd; command paths stay enforced', () => {
    const policy = { requireAbsoluteCwd: false }
    expect(load({ s: { command: 'npx', cwd: 'rel' } }, { policy }).s).toBeDefined()
    expect(() => load({ s: { command: './x.sh' } }, { policy })).toThrow(/\.command/)
  })

  it('maxTimeoutMs lowers the ceiling; the default ceiling is unchanged without it', () => {
    const policy = { maxTimeoutMs: 1000 }
    expect(load({ s: { command: 'npx', requestTimeoutMs: 1000 } }, { policy }).s).toBeDefined()
    expect(() => load({ s: { command: 'npx', requestTimeoutMs: 1001 } }, { policy })).toThrow(
      /requestTimeoutMs/,
    )
    expect(load({ s: { command: 'npx', requestTimeoutMs: 1001 } }).s).toBeDefined()
  })

  it('serverName replaces the name pattern; other defaults still apply', () => {
    const policy = { serverName: /^[A-Z_]+$/ }
    expect(load({ MY_SRV: { command: 'npx' } }, { policy }).MY_SRV).toBeDefined()
    expect(() => load({ ok: { command: 'npx' } }, { policy })).toThrow(McpFileError)
    expect(() => load({ MY_SRV: { command: 'npx', envPolicy: 'all' } }, { policy })).toThrow(
      /envPolicy/,
    )
  })

  it('a custom serverName may admit __proto__ and the entry is an own, enumerable server', () => {
    const path = join(dir, 'proto.json')
    writeFileSync(
      path,
      '{"mcpServers":{"__proto__":{"command":"npx","env":{"K":"long-enough-value"}}}}',
    )
    const out = loadMcpServersFile(path, {
      onWarn: () => undefined,
      policy: { serverName: /^[a-z_]+$/ },
    })
    expect(Object.keys(out)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(mcpSecretValues(out)).toEqual(['long-enough-value'])
  })

  it('refuseUnknownKeys false accepts unknown keys; the default refuses them', () => {
    const policy = { refuseUnknownKeys: false }
    expect(load({ s: { command: 'npx', extra: 1 } }, { policy }).s).toBeDefined()
    expect(() => load({ s: { command: 'npx', extra: 1 } })).toThrow(/extra/)
    expect(() => load({ s: { command: 'npx', envPolicy: 'all' } }, { policy })).toThrow(/envPolicy/)
  })

  it('refuses an unknown root key', () => {
    const path = join(dir, 'root.json')
    writeFileSync(path, JSON.stringify({ mcpServer: { s: { command: 'npx' } } }))
    expect(() => loadMcpServersFile(path)).toThrow(/mcpServer: unknown key/)
  })

  it('accepts type stdio and refuses another type on a command entry', () => {
    const out = load({ s: { type: 'stdio', command: 'node' } })
    expect(out.s).toEqual({ command: 'node' })
    expect(() => load({ s: { type: 'http', command: 'node' } })).toThrow(/mcpServers\.s\.type/)
  })
})
