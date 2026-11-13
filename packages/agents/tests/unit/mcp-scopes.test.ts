import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { McpFileError } from '../../src/bridge/mcp-file.js'
import { loadMcpScopes } from '../../src/bridge/mcp-scopes.js'

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

function dir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'mcp-scopes-'))
  made.push(d)
  for (const [n, c] of Object.entries(files)) writeFileSync(join(d, n), c)
  return d
}
const doc = (servers: Record<string, string>): string =>
  JSON.stringify({
    mcpServers: Object.fromEntries(Object.entries(servers).map(([k, c]) => [k, { command: c }])),
  })

describe('loadMcpScopes', () => {
  it('an untrusted project contributes no servers and its names are in projectWithheld', () => {
    const home = dir({ '.claude.json': doc({ mine: 'a' }) })
    const cwd = dir({ '.mcp.json': doc({ theirs: 'b' }) })
    const r = loadMcpScopes({ cwd, home, projectAllowed: false })
    expect(Object.keys(r.servers)).toEqual(['mine'])
    expect(r.projectWithheld).toEqual(['theirs'])
    expect(r.personal).toEqual(['mine'])
  })

  it('a trusted project adds its servers', () => {
    const home = dir({ '.claude.json': doc({ mine: 'a' }) })
    const cwd = dir({ '.mcp.json': doc({ theirs: 'b' }) })
    const r = loadMcpScopes({ cwd, home, projectAllowed: true })
    expect(Object.keys(r.servers).sort((a, b) => a.localeCompare(b))).toEqual(['mine', 'theirs'])
    expect(r.projectWithheld).toEqual([])
  })

  it('a clash keeps the personal server by default and lists the name in shadowed', () => {
    const home = dir({ '.claude.json': doc({ x: 'personal' }) })
    const cwd = dir({ '.mcp.json': doc({ x: 'project' }) })
    const r = loadMcpScopes({ cwd, home, projectAllowed: true })
    expect((r.servers.x as { command: string }).command).toBe('personal')
    expect(r.shadowed).toEqual([{ name: 'x', winner: 'personal' }])
  })

  it('onClash project-wins keeps the project server', () => {
    const home = dir({ '.claude.json': doc({ x: 'personal' }) })
    const cwd = dir({ '.mcp.json': doc({ x: 'project' }) })
    const r = loadMcpScopes({ cwd, home, projectAllowed: true, onClash: 'project-wins' })
    expect((r.servers.x as { command: string }).command).toBe('project')
    expect(r.shadowed).toEqual([{ name: 'x', winner: 'project' }])
    expect(r.personal).toEqual([])
  })

  it('reads a personal .mcp.json directory', () => {
    const extra = dir({ '.mcp.json': doc({ e: 'c' }) })
    const cwd = dir({})
    const r = loadMcpScopes({ cwd, home: dir({}), personalFiles: [extra], projectAllowed: true })
    expect(r.personal).toEqual(['e'])
  })

  it('a malformed project .mcp.json throws McpFileError and a malformed personal file only warns', () => {
    const goodHome = dir({})
    const badCwd = dir({ '.mcp.json': '{nope' })
    expect(() => loadMcpScopes({ cwd: badCwd, home: goodHome, projectAllowed: true })).toThrow(
      McpFileError,
    )
    const warnings: string[] = []
    const badHome = dir({ '.claude.json': '{nope' })
    const r = loadMcpScopes({
      cwd: dir({}),
      home: badHome,
      projectAllowed: true,
      onWarn: (m) => warnings.push(m),
    })
    expect(r.servers).toEqual({})
    expect(warnings).toHaveLength(1)
  })
})
