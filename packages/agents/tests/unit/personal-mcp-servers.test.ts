// The MCP servers an operator registered for themselves, which nothing was reading.
//
// `.mcp.json` is a project's declaration and `bridge/mcp-file.ts` has read it since B-043. The
// operator's own registrations live in `~/.claude.json` under the same `mcpServers` key, and the
// surfaces table listed them "not read yet, and in scope" — justified with "the personal scope
// measures 0". Re-measured 2026-09-15 on the machine that wrote that note: 2 servers, neither
// reaching an agent. A declared gap stays honest only while the number under it is current.
//
// ## What this must NOT read
//
// `~/.claude.json` is two things under one name. Its OAuth state and UI toggles belong to a
// specific CLI writing about its own session — a library reaching into another program's login
// state would be taking something it neither owns nor can refresh. Only `mcpServers` is read, and
// a test below pins that by putting a token beside it and asserting the result carries nothing
// but servers.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadPersonalMcpServers } from '../../src/bridge/mcp-file.js'

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

function homeWith(doc: unknown): string {
  const home = mkdtempSync(join(tmpdir(), 'personal-mcp-'))
  made.push(home)
  writeFileSync(join(home, '.claude.json'), JSON.stringify(doc))
  return home
}

const SERVER = { command: 'npx', args: ['-y', 'some-server'] }

describe('loadPersonalMcpServers', () => {
  it('reads the servers an operator registered for themselves', () => {
    const home = homeWith({ mcpServers: { context7: SERVER } })
    expect(Object.keys(loadPersonalMcpServers(home))).toEqual(['context7'])
  })

  it('reads NOTHING else from that file — it holds another program login state', () => {
    const home = homeWith({
      mcpServers: { context7: SERVER },
      oauthAccount: { accessToken: 'tok_must_not_travel' },
      editorMode: 'vim',
    })
    const out = loadPersonalMcpServers(home)
    expect(Object.keys(out)).toEqual(['context7'])
    expect(JSON.stringify(out)).not.toContain('tok_must_not_travel')
    expect(JSON.stringify(out)).not.toContain('vim')
  })

  it('is empty when the file is absent — the ordinary case, and silent', () => {
    const home = mkdtempSync(join(tmpdir(), 'personal-mcp-none-'))
    made.push(home)
    expect(loadPersonalMcpServers(home)).toEqual({})
  })

  it('is empty when the file exists without the key', () => {
    expect(loadPersonalMcpServers(homeWith({ editorMode: 'vim' }))).toEqual({})
  })

  it('does not throw on malformed JSON — one stray comma must not break every project', () => {
    const home = mkdtempSync(join(tmpdir(), 'personal-mcp-bad-'))
    made.push(home)
    writeFileSync(join(home, '.claude.json'), '{ "mcpServers": { ')
    const warnings: string[] = []
    expect(loadPersonalMcpServers(home, { onWarn: (m) => warnings.push(m) })).toEqual({})
    expect(warnings.join(' '), 'a file that cannot be parsed is reported, not swallowed').toMatch(
      /claude\.json/,
    )
  })
})
