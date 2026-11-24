import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

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

  it.each([true, false])(
    'a malformed project .mcp.json (projectAllowed %s) warns once and keeps the personal servers',
    (projectAllowed) => {
      const personalDir = dir({ '.mcp.json': doc({ mine: 'c' }) })
      const badCwd = dir({ '.mcp.json': '{nope' })
      const warnings: string[] = []
      const r = loadMcpScopes({
        cwd: badCwd,
        home: dir({}),
        personalFiles: [personalDir],
        projectAllowed,
        onWarn: (m) => warnings.push(m),
      })
      expect(Object.keys(r.servers)).toEqual(['mine'])
      expect(r.personal).toEqual(['mine'])
      expect(r.shadowed).toEqual([])
      expect(r.projectWithheld).toEqual([])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(badCwd)
    },
  )

  it('a malformed personal file only warns', () => {
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
