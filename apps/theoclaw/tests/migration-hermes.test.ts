import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { type ForeignSetup, readForeignSetup, type UntranslatedEntry } from '@theokit/agents/foreign-setup'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { copyFixture, FIXTURE_SECRETS, readHermesSetup } from './migration-fixtures.js'


/** The skills under `skillsDir` (named `skills`, in its own root) as the shared reader reads a Hermes root. */
function readSkillsDir(skillsDir: string, _rel: string, dropped: UntranslatedEntry[]): ForeignSetup['skills'] {
  const root = dirname(skillsDir)
  const setup = readForeignSetup('hermes', { home: root, configDir: root })
  dropped.push(...setup.untranslated)
  return setup.skills
}

/** FR-003, EC-1, EC-7, EC-9: the `SKILL.md` directory read both readers share. */
describe('readSkillsDir', () => {
  let dir = ''
  let skillsDir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'theoclaw-migration-'))
    skillsDir = join(dir, 'skills')
    mkdirSync(skillsDir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function skill(directory: string, frontmatter: string, body = 'Body.\n'): void {
    mkdirSync(join(skillsDir, directory), { recursive: true })
    writeFileSync(join(skillsDir, directory, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`)
  }

  it('reads name, description and body of each SKILL.md', () => {
    skill('one', 'name: one\ndescription: The first skill', 'Say ONE.\n')
    const dropped: UntranslatedEntry[] = []

    expect(readSkillsDir(skillsDir, 'skills', dropped)).toEqual([
      { name: 'one', description: 'The first skill', body: 'Say ONE.\n', requiresBins: [], path: 'skills/one/SKILL.md' },
    ])
    expect(dropped).toEqual([])
  })

  it('drops a skill named ../../evil as not a safe directory name (EC-1)', () => {
    skill('evil', 'name: ../../evil\ndescription: escapes')
    skill('safe-skill', 'name: safe-skill\ndescription: stays')
    const dropped: UntranslatedEntry[] = []

    expect(readSkillsDir(skillsDir, 'skills', dropped).map((s) => s.name)).toEqual(['safe-skill'])
    expect(dropped).toEqual([{ path: 'skills/evil/SKILL.md', reason: 'skill name is not a safe directory name' }])
  })

  it('keeps the first skill of a duplicated name and drops the other as duplicated (EC-7)', () => {
    skill('a', 'name: twin\ndescription: first')
    skill('b', 'name: twin\ndescription: second')
    const dropped: UntranslatedEntry[] = []

    expect(readSkillsDir(skillsDir, 'skills', dropped).map((s) => s.description)).toEqual(['first'])
    expect(dropped).toEqual([{ path: 'skills/b/SKILL.md', reason: 'duplicated name' }])
  })

  it('lists a skill directory without SKILL.md as dropped (EC-9)', () => {
    mkdirSync(join(skillsDir, 'empty'))
    skill('safe-skill', 'name: safe-skill\ndescription: stays')
    const dropped: UntranslatedEntry[] = []

    expect(readSkillsDir(skillsDir, 'skills', dropped).map((s) => s.name)).toEqual(['safe-skill'])
    expect(dropped).toEqual([{ path: 'skills/empty', reason: 'no SKILL.md' }])
  })

  it('drops a SKILL.md whose frontmatter lacks name or description', () => {
    skill('no-description', 'name: no-description')
    writeFileSync(join(skillsDir, 'stray.md'), 'not a skill directory')
    mkdirSync(join(skillsDir, 'no-frontmatter'))
    writeFileSync(join(skillsDir, 'no-frontmatter', 'SKILL.md'), 'just text')
    const dropped: UntranslatedEntry[] = []

    expect(readSkillsDir(skillsDir, 'skills', dropped)).toEqual([])
    expect(dropped).toEqual([
      { path: 'skills/no-description/SKILL.md', reason: 'frontmatter lacks name or description' },
      { path: 'skills/no-frontmatter/SKILL.md', reason: 'frontmatter lacks name or description' },
    ])
  })

  it('reads a SKILL.md of exactly 262144 bytes and drops one of 262145 bytes (D4)', () => {
    const header = '---\nname: big\ndescription: large\n---\n'
    mkdirSync(join(skillsDir, 'exact'))
    writeFileSync(join(skillsDir, 'exact', 'SKILL.md'), header + 'x'.repeat(262_144 - header.length))
    mkdirSync(join(skillsDir, 'over'))
    writeFileSync(join(skillsDir, 'over', 'SKILL.md'), header.replace('big', 'over') + 'x'.repeat(262_145 - header.length - 1))
    const dropped: UntranslatedEntry[] = []

    expect(readSkillsDir(skillsDir, 'skills', dropped).map((s) => s.name)).toEqual(['big'])
    expect(dropped).toEqual([{ path: 'skills/over/SKILL.md', reason: 'file over 262144 bytes' }])
  })

  it('follows a symlinked skill directory', () => {
    const elsewhere = join(dir, 'linked-target')
    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, 'SKILL.md'), '---\nname: linked\ndescription: through a link\n---\nLinked.\n')
    symlinkSync(elsewhere, join(skillsDir, 'linked'))
    try {
      expect(readSkillsDir(skillsDir, 'skills', []).map((s) => s.name)).toEqual(['linked'])
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('reads CRLF frontmatter and drops one that is not valid YAML', () => {
    mkdirSync(join(skillsDir, 'crlf'))
    writeFileSync(join(skillsDir, 'crlf', 'SKILL.md'), '---\r\nname: crlf\r\ndescription: windows\r\n---\r\nBody.\r\n')
    skill('bad-yaml', 'name: [unclosed\ndescription: x')
    const dropped: UntranslatedEntry[] = []

    expect(readSkillsDir(skillsDir, 'skills', dropped).map((s) => [s.name, s.body])).toEqual([['crlf', 'Body.\r\n']])
    expect(dropped).toEqual([{ path: 'skills/bad-yaml/SKILL.md', reason: 'frontmatter lacks name or description' }])
  })

  it('does not close the frontmatter on a line that only starts with ---', () => {
    skill('dashes', 'name: dashes\ndescription: |\n  ---x is part of the text')

    expect(readSkillsDir(skillsDir, 'skills', []).map((s) => s.description)).toEqual(['---x is part of the text\n'])
  })

  it('reads nothing from a missing directory', () => {
    expect(readSkillsDir(join(dir, 'x', 'skills'), 'skills', [])).toEqual([])
  })
})

/** FR-002, FR-003 (AC-003, AC-004, AC-005): reading a Hermes home. */
describe('readHermesSetup', () => {
  let root = ''

  beforeEach(() => {
    root = copyFixture('hermes', mkdtempSync(join(tmpdir(), 'theoclaw-migration-')))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads instructions, mcp_servers, skills and memories of a Hermes home', () => {
    const setup = readHermesSetup({ root })

    expect(setup.kind).toBe('hermes')
    expect(setup.source).toBe(root)
    expect(setup.instructions.map((file) => file.path)).toEqual(['SOUL.md', 'AGENTS.md'])
    expect(setup.instructions[1]?.text).toContain('team is called Orbit')
    expect(setup.mcpServers).toEqual({
      files: { command: 'npx', args: ['-y', 'fixture-files-server'], env: { PORT: '8080', FILES_TOKEN: 'fixture-secret-hermes-token' } },
      web: { type: 'http', url: 'https://web.example.test/mcp', headers: { Authorization: 'Bearer fixture-secret-hermes-header' } },
    })
    expect(setup.skills.map((skill) => [skill.name, skill.path])).toEqual([['hermes-skill', 'skills/hermes-skill/SKILL.md']])
    expect(setup.memories.map((file) => file.path)).toEqual(['memories/MEMORY.md', 'memories/USER.md'])
    expect(setup.memories[1]?.text).toContain('metric units')
  })

  it('falls back from mcp_servers to mcp.servers and then mcp and stringifies numeric env values', () => {
    const configs = [
      'mcp_servers:\n  one:\n    command: a\n    env:\n      PORT: 8080\n',
      'mcp:\n  servers:\n    one:\n      command: a\n      env:\n        PORT: 8080\n',
      'mcp:\n  one:\n    command: a\n    env:\n      PORT: 8080\n',
      // A `mcp_servers` that is not a map falls through to the next location.
      'mcp_servers: none\nmcp:\n  servers:\n    one:\n      command: a\n      env:\n        PORT: 8080\n',
    ]
    for (const config of configs) {
      writeFileSync(join(root, 'config.yaml'), config)

      const setup = readHermesSetup({ root })

      expect(setup.mcpServers, config).toEqual({ one: { command: 'a', env: { PORT: '8080' } } })
      expect(setup.untranslated.filter((entry) => entry.path.startsWith('config.yaml')), config).toEqual([])
    }
  })

  it('lists every entry it does not carry with its reason', () => {
    writeFileSync(join(root, 'SOUL.md'), 'x'.repeat(300_000))
    writeFileSync(
      join(root, 'config.yaml'),
      [
        'mcp_servers:',
        '  neither: { args: [x] }',
        '  both: { command: a, url: "https://h" }',
        '  bad-args: { command: a, args: [1, 2] }',
        '  ftp: { url: "ftp://h/x" }',
        '  slow: { command: a, timeout: 5 }',
      ].join('\n'),
    )

    const setup = readHermesSetup({ root })

    expect(setup.untranslated).toEqual([
      { path: 'SOUL.md', reason: 'file over 262144 bytes' },
      { path: 'config.yaml#neither', reason: 'neither command nor url' },
      { path: 'config.yaml#both', reason: 'both command and url' },
      { path: 'config.yaml#bad-args', reason: 'args is not an array of strings' },
      { path: 'config.yaml#ftp', reason: 'url is not http: or https:' },
      { path: 'config.yaml#slow.timeout', reason: 'field not carried' },
      { path: 'skills/no-description/SKILL.md', reason: 'frontmatter lacks name or description' },
      { path: 'platforms', reason: 'channels are not imported' },
      { path: 'channel_directory.json', reason: 'channels are not imported' },
    ])
    expect(setup.instructions.map((file) => file.path)).toEqual(['AGENTS.md'])
    expect(Object.keys(setup.mcpServers)).toEqual(['slow'])
  })

  it('stages a numeric env or header value as it was written, not as YAML reads the number', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      'mcp_servers:\n  one:\n    command: a\n    args: [x]\n    env:\n      HEX: 0x1F\n      VERSION: 1.10\n      BIG: 12345678901234567890\n      ON: true\n',
    )

    expect(readHermesSetup({ root }).mcpServers.one).toEqual({
      command: 'a',
      args: ['x'],
      env: { HEX: '0x1F', VERSION: '1.10', BIG: '12345678901234567890', ON: 'true' },
    })
  })

  it('keeps the text of a numeric header, of an aliased env map and of a merged one', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      [
        'defaults: &defaults { PORT: 0x1F }',
        'mcp_servers:',
        '  aliased: { command: a, env: *defaults }',
        '  merged: { command: a, env: { <<: *defaults, EXTRA: 1.10 } }',
        '  web: { url: "https://h/mcp", headers: { X-Version: 1.10 } }',
      ].join('\n'),
    )

    const { mcpServers, untranslated: dropped } = readHermesSetup({ root })

    expect(mcpServers).toEqual({
      aliased: { command: 'a', env: { PORT: '0x1F' } },
      merged: { command: 'a', env: { PORT: '0x1F', EXTRA: '1.10' } },
      web: { type: 'http', url: 'https://h/mcp', headers: { 'X-Version': '1.10' } },
    })
    expect(dropped.filter((entry) => entry.path.startsWith('config.yaml'))).toEqual([])
  })

  it('falls through a mcp.servers that is not a map to mcp itself', () => {
    writeFileSync(join(root, 'config.yaml'), 'mcp:\n  servers: none\n  one: { command: a }\n')

    const setup = readHermesSetup({ root })

    expect(setup.mcpServers).toEqual({ one: { command: 'a' } })
    expect(setup.untranslated).toContainEqual({ path: 'config.yaml#servers', reason: 'not an object' })
  })

  it('reads an empty config.yaml or one with no MCP map as no server and no drop', () => {
    for (const config of ['', 'model: x\n', '- a list\n']) {
      writeFileSync(join(root, 'config.yaml'), config)
      const setup = readHermesSetup({ root })

      expect(setup.mcpServers, config).toEqual({})
      expect(setup.untranslated.filter((entry) => entry.path.startsWith('config.yaml')), config).toEqual([])
    }
  })

  it('lists a config.yaml over 262144 bytes as dropped', () => {
    writeFileSync(join(root, 'config.yaml'), `# ${'x'.repeat(262_144)}\n`)

    expect(readHermesSetup({ root }).untranslated).toContainEqual({ path: 'config.yaml', reason: 'file over 262144 bytes' })
  })

  it('never puts a fixture secret in a dropped entry', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      'mcp_servers:\n  one: { command: a, env: { T: { v: fixture-secret-hermes-token } }, extra: fixture-secret-hermes-token }\n',
    )

    const dropped = JSON.stringify(readHermesSetup({ root }).untranslated)

    for (const secret of FIXTURE_SECRETS) expect(dropped).not.toContain(secret)
  })

  it('drops an entry whose env value is empty', () => {
    writeFileSync(join(root, 'config.yaml'), 'mcp_servers:\n  one:\n    command: a\n    env:\n      KEY:\n')

    expect(readHermesSetup({ root }).untranslated).toContainEqual({ path: 'config.yaml#one', reason: 'env value is not a string, number or boolean' })
  })

  it('takes the last value of a repeated key, as Hermes does', () => {
    writeFileSync(join(root, 'config.yaml'), 'mcp_servers:\n  one: { command: a }\n  one: { command: b }\n')

    const setup = readHermesSetup({ root })

    expect(setup.mcpServers).toEqual({ one: { command: 'b' } })
    expect(setup.untranslated.filter((entry) => entry.path.startsWith('config.yaml'))).toEqual([])
  })

  it('lists a config.yaml that does not parse as dropped and reads the rest', () => {
    writeFileSync(join(root, 'config.yaml'), 'mcp_servers: [unclosed\n')

    const setup = readHermesSetup({ root })

    expect(setup.untranslated).toContainEqual({ path: 'config.yaml', reason: 'not valid YAML' })
    expect(setup.mcpServers).toEqual({})
    expect(setup.skills.map((skill) => skill.name)).toEqual(['hermes-skill'])
  })

  it('reads an empty Hermes home as nothing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'theoclaw-migration-'))
    try {
      expect(readHermesSetup({ root: empty })).toEqual({
        kind: 'hermes',
        source: empty,
        instructions: [],
        mcpServers: {},
        skills: [],
        memories: [],
        hooks: [],
        untranslated: [],
      })
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
