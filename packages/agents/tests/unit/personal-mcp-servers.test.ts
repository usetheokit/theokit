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
  it('names the file it actually read, not the project one it reuses the parser from', () => {
    // MEASURED 2026-09-15 against the real `~/.claude.json` on the machine this shipped from:
    //
    //   [@theokit/agents] .mcp.json: server "context7" declares "type", ... it is NOT being applied.
    //
    // That text came from the PERSONAL file. `reportUncarriedKeys` hardcoded the project filename,
    // and reusing `parseMcpJson` for the personal scope — which is the right call, one parser for
    // one format — inherited a message that had silently become false.
    //
    // The cost is specific, not cosmetic: an operator reads it and opens `.mcp.json` looking for a
    // `type` key that is not there. A diagnostic that sends someone to the wrong file is worse than
    // silence, because silence does not consume the search.
    const warnings: string[] = []
    // The real entry from the machine this shipped from: `type` on a STDIO server, which the
    // stdio key set does not carry. On a `url` server `type` IS carried, so a remote fixture would
    // emit nothing and the test would pass over an empty list — the vacuous shape this file's
    // sibling checks already guard against.
    const home = homeWith({
      mcpServers: {
        context7: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
      },
    })
    loadPersonalMcpServers(home, { onWarn: (m) => warnings.push(m) })
    const uncarried = warnings.filter((w) => w.includes('does not carry'))
    expect(uncarried).toHaveLength(1)
    expect(uncarried[0]).toContain('.claude.json')
    expect(uncarried[0]).not.toContain('.mcp.json')
  })
})
