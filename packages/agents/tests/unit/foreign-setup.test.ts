import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readForeignSetup } from '../../src/foreign-setup/index.js'

function write(root: string, rel: string, text: string): void {
  const path = join(root, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

describe('readForeignSetup', () => {
  it('reads a Claude Code home: instructions, skills, MCP servers and hooks', () => {
    const home = mkdtempSync(join(tmpdir(), 'fs-claude-'))
    const cwd = mkdtempSync(join(tmpdir(), 'fs-proj-'))
    write(home, '.claude/CLAUDE.md', 'be brief')
    write(
      home,
      '.claude/skills/triage/SKILL.md',
      '---\nname: triage\ndescription: sort issues\n---\nbody\n',
    )
    write(home, '.claude/skills/broken/SKILL.md', 'no frontmatter')
    write(
      home,
      '.claude.json',
      JSON.stringify({
        mcpServers: {
          files: {
            command: 'npx',
            args: ['-y', 'fs'],
            env: { TOKEN: 'secret-value' },
            type: 'stdio',
          },
          remote: { type: 'http', url: 'https://example.com/mcp' },
          ws: { type: 'ws', url: 'https://example.com/ws' },
          both: { command: 'x', url: 'https://example.com' },
        },
      }),
    )
    write(
      home,
      '.claude/settings.json',
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi', timeout: 5 }] },
          ],
          Notification: [{ hooks: [{ type: 'command', command: 'x' }] }],
        },
      }),
    )
    write(cwd, 'CLAUDE.md', 'project rules')

    const setup = readForeignSetup('claude-code', { home, cwd })

    expect(setup.instructions.map((f) => f.path)).toEqual(['CLAUDE.md', 'project/CLAUDE.md'])
    expect(setup.skills.map((s) => s.name)).toEqual(['triage'])
    expect(Object.keys(setup.mcpServers).sort((a, b) => a.localeCompare(b))).toEqual([
      'files',
      'remote',
    ])
    expect(setup.mcpServers.files).toEqual({
      command: 'npx',
      args: ['-y', 'fs'],
      env: { TOKEN: 'secret-value' },
    })
    expect(setup.hooks).toEqual([
      { event: 'pre_tool_call', command: 'echo hi', matcher: 'Bash', timeoutMs: 5000 },
    ])
    expect(setup.untranslated).toContainEqual({
      path: '.claude.json#ws',
      reason: 'transport is not http or sse',
    })
    expect(setup.untranslated).toContainEqual({
      path: '.claude.json#both',
      reason: 'both command and url',
    })
    expect(setup.untranslated.some((u) => u.path === 'skills/broken/SKILL.md')).toBe(true)
    expect(setup.untranslated.some((u) => u.path === 'settings.json#hooks')).toBe(true)
    expect(JSON.stringify(setup.untranslated)).not.toContain('secret-value')
  })

  it('reads a Hermes home', () => {
    const home = mkdtempSync(join(tmpdir(), 'fs-hermes-'))
    write(home, '.hermes/SOUL.md', 'soul')
    write(
      home,
      '.hermes/config.yaml',
      'mcp_servers:\n  git:\n    command: git-mcp\n    env:\n      N: 1.10\n  bad:\n    url: ftp://x\n',
    )
    const setup = readForeignSetup('hermes', { home })
    expect(setup.instructions).toEqual([{ path: 'SOUL.md', text: 'soul' }])
    expect(setup.mcpServers).toEqual({ git: { command: 'git-mcp', env: { N: '1.10' } } })
    expect(setup.untranslated).toEqual([
      { path: 'config.yaml#bad', reason: 'url is not http: or https:' },
    ])
    expect(setup.hooks).toEqual([])
  })

  it('reads the project scope: hooks, .mcp.json and skills that shadow the user ones', () => {
    const home = mkdtempSync(join(tmpdir(), 'fs-claude-'))
    const cwd = mkdtempSync(join(tmpdir(), 'fs-proj-'))
    const skill = (d: string): string => `---\nname: triage\ndescription: ${d}\n---\nbody\n`
    write(home, '.claude/skills/triage/SKILL.md', skill('user'))
    write(cwd, '.claude/skills/triage/SKILL.md', skill('project'))
    write(
      home,
      '.claude/settings.json',
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-hook' }] }] } }),
    )
    write(
      cwd,
      '.claude/settings.json',
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'project-hook' }] }] },
      }),
    )
    write(
      home,
      '.claude.json',
      JSON.stringify({ mcpServers: { a: { command: 'user-a' }, b: { command: 'user-b' } } }),
    )
    write(
      cwd,
      '.mcp.json',
      JSON.stringify({
        mcpServers: { a: { command: 'project-a' }, bad: { command: 'x', url: 'https://x.test' } },
      }),
    )

    const setup = readForeignSetup('claude-code', { home, cwd })

    expect(setup.hooks.map((h) => h.command)).toEqual(['user-hook', 'project-hook'])
    expect(setup.mcpServers).toEqual({ a: { command: 'project-a' }, b: { command: 'user-b' } })
    expect(setup.skills).toHaveLength(1)
    expect(setup.skills[0]).toMatchObject({
      description: 'project',
      path: 'project/.claude/skills/triage/SKILL.md',
    })
    expect(setup.untranslated).toEqual(
      expect.arrayContaining([
        { path: 'skills/triage/SKILL.md', reason: 'shadowed by the project scope' },
        { path: 'project/.mcp.json#bad', reason: 'both command and url' },
      ]),
    )
  })

  it('reads Claude auto memory by git root, requiresBins, a configDir and shadowed servers', () => {
    const home = mkdtempSync(join(tmpdir(), 'fs-c2-'))
    const cwd = mkdtempSync(join(tmpdir(), 'fs-p2-'))
    const configDir = join(home, 'elsewhere')
    const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-')
    write(configDir, `projects/${encoded}/memory/b.md`, 'bee')
    write(configDir, `projects/${encoded}/memory/MEMORY.md`, 'index')
    write(
      configDir,
      'skills/s/SKILL.md',
      '---\nname: s\ndescription: d\nmetadata:\n  requires:\n    bins: [git, 3, ""]\n---\nbody\n',
    )
    write(
      home,
      '.claude.json',
      JSON.stringify({ mcpServers: { a: { command: 'u' }, b: { command: 'u' } } }),
    )
    write(cwd, '.mcp.json', JSON.stringify({ mcpServers: { a: { command: 'p' } } }))
    const setup = readForeignSetup('claude-code', { home, cwd, configDir })
    expect(setup.source).toBe(configDir)
    expect(setup.memories.map((m) => m.text)).toEqual(['index', 'bee'])
    expect(setup.skills[0].requiresBins).toEqual(['git'])
    expect(setup.mcpServers).toEqual({ a: { command: 'p' }, b: { command: 'u' } })
    expect(setup.untranslated).toContainEqual({
      path: '.claude.json#a',
      reason: 'shadowed by the project scope',
    })
  })

  it('reads Hermes memories, records dropped channels and honours configDir', () => {
    const home = mkdtempSync(join(tmpdir(), 'fs-h2-'))
    const configDir = join(home, 'custom')
    write(configDir, 'memories/USER.md', 'user')
    write(configDir, 'memories/MEMORY.md', 'mem')
    write(configDir, 'platforms/x.json', '{}')
    const setup = readForeignSetup('hermes', { home, configDir })
    expect(setup.source).toBe(configDir)
    expect(setup.memories.map((m) => m.path)).toEqual(['memories/MEMORY.md', 'memories/USER.md'])
    expect(setup.untranslated).toContainEqual({
      path: 'platforms',
      reason: 'channels are not imported',
    })
  })
})
